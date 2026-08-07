#include <napi.h>
#include <cmath>
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <EventKit/EventKit.h>

static EKEventStore *store = nil;
static EKEventStore *eventStore() { if (!store) store = [[EKEventStore alloc] init]; return store; }
// 独立的全局变更通知仅唤醒 JS 协调器；它不携带项目数据，实际读取仍严格限定在用户已连接的集合。
static id eventStoreChangeObserver = nil;
static std::unique_ptr<Napi::ThreadSafeFunction> eventStoreChangeListener;

static NSString *statusName(EKAuthorizationStatus status) {
  switch (status) { case EKAuthorizationStatusFullAccess: return @"full-access"; case EKAuthorizationStatusWriteOnly: return @"write-only"; case EKAuthorizationStatusNotDetermined: return @"not-determined"; case EKAuthorizationStatusDenied: return @"denied"; case EKAuthorizationStatusRestricted: return @"restricted"; }
}
static EKEntityType typeFor(NSString *entity) { return [entity isEqualToString:@"calendar"] ? EKEntityTypeEvent : EKEntityTypeReminder; }
static NSString *sourceType(EKSourceType type) { switch (type) { case EKSourceTypeCalDAV: return @"caldav"; case EKSourceTypeExchange: return @"exchange"; case EKSourceTypeLocal: return @"local"; case EKSourceTypeBirthdays: return @"birthdays"; case EKSourceTypeMobileMe: return @"mobileme"; case EKSourceTypeSubscribed: return @"subscribed"; default: return @"unknown"; } }

class CommandContext {
 public:
  Napi::Env env;
  std::shared_ptr<Napi::Promise::Deferred> deferred;
  CommandContext(Napi::Env env) : env(env) { deferred = std::make_shared<Napi::Promise::Deferred>(Napi::Promise::Deferred::New(env)); }
  // execute() and every EventKit completion below are serialized back to dispatch_get_main_queue(),
  // which is Electron main's JavaScript thread. Never use ThreadSafeFunction from that same thread.
  void resolve(NSString *value) { Napi::HandleScope scope(env); deferred->Resolve(Napi::String::New(env, std::string([value UTF8String] ?: "{}"))); delete this; }
  void reject(NSString *message) { Napi::HandleScope scope(env); deferred->Reject(Napi::Error::New(env, std::string([message UTF8String] ?: "EventKit request failed")).Value()); delete this; }
};

static NSString *json(id object) { NSError *error = nil; NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error]; return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}"; }
static NSNumber *number(NSDictionary *payload, NSString *key) { id value = payload[key]; return [value isKindOfClass:[NSNumber class]] ? value : nil; }
static NSString *string(NSDictionary *payload, NSString *key) { id value = payload[key]; return [value isKindOfClass:[NSString class]] ? value : nil; }
static NSDate *date(NSNumber *milliseconds) { return [NSDate dateWithTimeIntervalSince1970:milliseconds.doubleValue / 1000.0]; }
static NSURL *identityURL(NSString *entity, NSString *identity) { return identity ? [NSURL URLWithString:[NSString stringWithFormat:@"proma://planning/%@/%@", entity, identity]] : nil; }
static NSDictionary *itemResponse(EKCalendarItem *item) { return @{ @"calendarItemIdentifier": item.calendarItemIdentifier ?: @"", @"calendarItemExternalIdentifier": item.calendarItemExternalIdentifier ?: @"" }; }
static NSNumber *milliseconds(NSDate *value) { return value ? @((long long)llround(value.timeIntervalSince1970 * 1000.0)) : nil; }
// 只回传 Proma 自己写入的严格 UUID marker；用户的任意 EventKit URL 不得进入 JS 层。
static NSString *promaIdentity(NSString *entity, EKCalendarItem *item) {
  NSString *prefix = [NSString stringWithFormat:@"proma://planning/%@/", entity];
  NSString *absolute = item.URL.absoluteString;
  if (![absolute hasPrefix:prefix]) return nil;
  NSString *identity = [absolute substringFromIndex:prefix.length];
  return [[NSUUID alloc] initWithUUIDString:identity] ? identity : nil;
}
static NSDictionary *itemDTO(NSString *entity, EKCalendarItem *item) {
  NSMutableDictionary *result = [@{ @"calendarItemIdentifier": item.calendarItemIdentifier ?: @"", @"calendarItemExternalIdentifier": item.calendarItemExternalIdentifier ?: @"", @"title": item.title ?: @"", @"notes": item.notes ?: @"", @"lastModifiedAt": milliseconds(item.lastModifiedDate) ?: @0 } mutableCopy];
  NSString *identity = promaIdentity(entity, item); if (identity) result[@"promaIdentity"] = identity;
  if ([entity isEqualToString:@"calendar"]) { EKEvent *event = (EKEvent *)item; result[@"startAt"] = milliseconds(event.startDate) ?: @0; result[@"endAt"] = milliseconds(event.endDate) ?: @0; result[@"allDay"] = @(event.allDay); result[@"isRecurring"] = @(event.recurrenceRules.count > 0); }
  else { EKReminder *reminder = (EKReminder *)item; NSDate *due = reminder.dueDateComponents ? [[NSCalendar currentCalendar] dateFromComponents:reminder.dueDateComponents] : nil; if (due) result[@"dueAt"] = milliseconds(due); result[@"dueDateOnly"] = @(reminder.dueDateComponents && reminder.dueDateComponents.hour == NSDateComponentUndefined); result[@"priority"] = reminder.priority <= 4 ? @"high" : reminder.priority >= 6 ? @"low" : @"medium"; result[@"completed"] = @(reminder.completed); if (reminder.completionDate) result[@"completedAt"] = milliseconds(reminder.completionDate); }
  return result;
}

static EKCalendarItem *recoveredItem(NSString *entity, EKCalendar *target, NSDictionary *payload) {
  NSString *identity = string(payload, @"identity"); NSURL *marker = identityURL(entity, identity); if (!marker) return nil;
  if ([entity isEqualToString:@"calendar"]) {
    // 删除后本地日程快照可能已不存在。带 anchor 时精确查找；仅 crash-recovery 时退化为较宽窗口。
    NSNumber *anchorValue = number(payload, @"startAt");
    NSDate *anchor = date(anchorValue ?: @([NSDate date].timeIntervalSince1970 * 1000));
    NSInteger before = anchorValue ? -1 : -3650, after = anchorValue ? 2 : 3650;
    NSDate *start = [[NSCalendar currentCalendar] dateByAddingUnit:NSCalendarUnitDay value:before toDate:anchor options:0];
    NSDate *end = [[NSCalendar currentCalendar] dateByAddingUnit:NSCalendarUnitDay value:after toDate:anchor options:0];
    NSPredicate *predicate = [eventStore() predicateForEventsWithStartDate:start endDate:end calendars:@[target]];
    for (EKEvent *event in [eventStore() eventsMatchingPredicate:predicate]) if ([event.URL isEqual:marker]) return event;
  }
  return nil;
}

static void upsert(NSString *entity, NSDictionary *payload, CommandContext *ctx, NSArray<EKReminder *> *recoveredReminders) {
  NSString *targetId = string(payload, @"targetId"), *title = string(payload, @"title"); EKCalendar *target = targetId ? [eventStore() calendarWithIdentifier:targetId] : nil;
  if (!target || !target.allowsContentModifications || !title) { ctx->reject(@"同步目标不可写或数据无效"); return; }
  NSString *identifier = string(payload, @"calendarItemIdentifier"); EKCalendarItem *recovered = identifier ? nil : ([entity isEqualToString:@"reminder"] ? ([recoveredReminders firstObject]) : recoveredItem(entity, target, payload));
  NSError *error = nil;
  if ([entity isEqualToString:@"calendar"]) {
    EKEvent *event = identifier ? (EKEvent *)[eventStore() calendarItemWithIdentifier:identifier] : nil; if (event && ![event.calendar.calendarIdentifier isEqualToString:target.calendarIdentifier]) { ctx->reject(@"系统项目已移出连接集合"); return; } if (!event && identifier && ![number(payload, @"allowRecreate") boolValue]) { ctx->reject(@"系统日程已不存在；请选择保留 Proma 后再重建"); return; } if (!event) event = (EKEvent *)recovered; if (!event) event = [EKEvent eventWithEventStore:eventStore()];
    NSNumber *startAt = number(payload, @"startAt"); if (!startAt) { ctx->reject(@"日程缺少开始时间"); return; }
    event.calendar = target; event.title = title; event.notes = string(payload, @"notes"); if (!event.URL) event.URL = identityURL(entity, string(payload, @"identity"));
    event.startDate = date(startAt); event.endDate = date(number(payload, @"endAt") ?: @(startAt.doubleValue + 3600000)); event.allDay = [number(payload, @"allDay") boolValue];
    if (![eventStore() saveEvent:event span:EKSpanThisEvent commit:YES error:&error]) { ctx->reject(error.localizedDescription); return; }
    ctx->resolve(json(itemResponse(event))); return;
  }
  EKReminder *reminder = identifier ? (EKReminder *)[eventStore() calendarItemWithIdentifier:identifier] : nil; if (reminder && ![reminder.calendar.calendarIdentifier isEqualToString:target.calendarIdentifier]) { ctx->reject(@"系统项目已移出连接集合"); return; } if (!reminder && identifier && ![number(payload, @"allowRecreate") boolValue]) { ctx->reject(@"系统提醒事项已不存在；请选择保留 Proma 后再重建"); return; } if (!reminder) reminder = (EKReminder *)recovered; if (!reminder) reminder = [EKReminder reminderWithEventStore:eventStore()];
  reminder.calendar = target; reminder.title = title; reminder.notes = string(payload, @"notes"); if (!reminder.URL) reminder.URL = identityURL(entity, string(payload, @"identity"));
  NSNumber *dueAt = number(payload, @"dueAt"); if (dueAt) { NSDate *due = date(dueAt); NSCalendarUnit units = [number(payload, @"dueDateOnly") boolValue] ? (NSCalendarUnitYear|NSCalendarUnitMonth|NSCalendarUnitDay) : (NSCalendarUnitYear|NSCalendarUnitMonth|NSCalendarUnitDay|NSCalendarUnitHour|NSCalendarUnitMinute|NSCalendarUnitSecond); NSDateComponents *components = [[NSCalendar currentCalendar] components:units fromDate:due]; components.timeZone = NSTimeZone.localTimeZone; reminder.dueDateComponents = components; } else reminder.dueDateComponents = nil;
  NSString *priority = string(payload, @"priority") ?: @"medium"; reminder.priority = [priority isEqualToString:@"high"] ? 1 : [priority isEqualToString:@"low"] ? 9 : 5;
  reminder.completed = [number(payload, @"completed") boolValue]; NSNumber *completedAt = number(payload, @"completedAt"); reminder.completionDate = reminder.completed && completedAt ? date(completedAt) : nil;
  if (![eventStore() saveReminder:reminder commit:YES error:&error]) { ctx->reject(error.localizedDescription); return; }
  ctx->resolve(json(itemResponse(reminder)));
}

static void removeItem(NSString *entity, EKCalendarItem *item, CommandContext *ctx) {
  NSError *error = nil;
  if (item) {
    BOOL ok = [entity isEqualToString:@"calendar"] ? [eventStore() removeEvent:(EKEvent *)item span:EKSpanThisEvent commit:YES error:&error] : [eventStore() removeReminder:(EKReminder *)item commit:YES error:&error];
    if (!ok) { ctx->reject(error.localizedDescription); return; }
  }
  ctx->resolve(@"{}");
}

static void execute(NSString *command, NSString *entity, NSDictionary *payload, CommandContext *ctx) {
  @autoreleasepool {
    if (!@available(macOS 14.0, *)) { ctx->resolve(json(@{ @"entity": entity, @"status": @"unsupported" })); return; }
    NSLog(@"[PromaEventKit] executing %@ for %@ (status=%@)", command, entity, statusName([EKEventStore authorizationStatusForEntityType:typeFor(entity)]));
    EKEntityType entityType = typeFor(entity);
    if ([command isEqualToString:@"authorizationStatus"]) { ctx->resolve(json(@{ @"entity": entity, @"status": statusName([EKEventStore authorizationStatusForEntityType:entityType]) })); return; }
    if ([command isEqualToString:@"requestAccess"]) {
      // Electron main 可能不是前台应用；显式激活其 NSApplication，确保 TCC sheet 可呈现。
      NSLog(@"[PromaEventKit] requesting TCC with NSApp=%@ active=%d", NSApp, NSApp.isActive);
      [NSApp activateIgnoringOtherApps:YES];
      void (^completion)(BOOL, NSError *) = ^(BOOL granted, NSError *error) { dispatch_async(dispatch_get_main_queue(), ^{ ctx->resolve(json(@{ @"entity": entity, @"status": statusName([EKEventStore authorizationStatusForEntityType:entityType]), @"granted": @(granted), @"error": error.localizedDescription ?: @"" })); }); };
      if ([entity isEqualToString:@"calendar"]) [eventStore() requestFullAccessToEventsWithCompletion:completion]; else [eventStore() requestFullAccessToRemindersWithCompletion:completion];
      return;
    }
    if ([command isEqualToString:@"listWritableTargets"] || [command isEqualToString:@"listTargets"]) {
      if (![statusName([EKEventStore authorizationStatusForEntityType:entityType]) isEqualToString:@"full-access"]) { ctx->resolve(@"[]"); return; }
      BOOL writableOnly = [command isEqualToString:@"listWritableTargets"]; NSMutableArray *targets = [NSMutableArray array];
      for (EKCalendar *calendar in [eventStore() calendarsForEntityType:entityType]) if ((!writableOnly || calendar.allowsContentModifications) && !calendar.isSubscribed) [targets addObject:@{ @"id": calendar.calendarIdentifier ?: @"", @"title": calendar.title ?: @"", @"sourceTitle": calendar.source.title ?: @"", @"sourceType": sourceType(calendar.source.sourceType), @"canWrite": @(calendar.allowsContentModifications), @"isCloudBacked": @((calendar.source.sourceType == EKSourceTypeCalDAV) || (calendar.source.sourceType == EKSourceTypeExchange) || (calendar.source.sourceType == EKSourceTypeMobileMe)) }];
      [targets sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) { return [[NSString stringWithFormat:@"%@%@", a[@"sourceTitle"], a[@"title"]] localizedStandardCompare:[NSString stringWithFormat:@"%@%@", b[@"sourceTitle"], b[@"title"]]]; }]; ctx->resolve(json(targets)); return;
    }
    if ([command isEqualToString:@"listItems"]) {
      EKCalendar *target = [eventStore() calendarWithIdentifier:string(payload, @"targetId")];
      if (!target) { ctx->reject(@"未找到已连接的系统集合"); return; }
      NSArray *identifiers = [payload[@"calendarItemIdentifiers"] isKindOfClass:[NSArray class]] ? payload[@"calendarItemIdentifiers"] : nil;
      if (identifiers) { NSMutableArray *items = [NSMutableArray array]; for (id identifierValue in identifiers) { if (![identifierValue isKindOfClass:[NSString class]]) continue; EKCalendarItem *item = [eventStore() calendarItemWithIdentifier:identifierValue]; if (item && [item.calendar.calendarIdentifier isEqualToString:target.calendarIdentifier]) [items addObject:itemDTO(entity, item)]; } ctx->resolve(json(items)); return; }
      if ([entity isEqualToString:@"calendar"]) { NSNumber *fromValue = number(payload, @"from"), *toValue = number(payload, @"to"); if (!fromValue || !toValue) { ctx->reject(@"日程读取缺少时间范围"); return; } NSPredicate *predicate = [eventStore() predicateForEventsWithStartDate:date(fromValue) endDate:date(toValue) calendars:@[target]]; NSMutableArray *items = [NSMutableArray array]; for (EKEvent *event in [eventStore() eventsMatchingPredicate:predicate]) [items addObject:itemDTO(entity, event)]; ctx->resolve(json(items)); return; }
      NSPredicate *predicate = [eventStore() predicateForRemindersInCalendars:@[target]]; [eventStore() fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *reminders) { dispatch_async(dispatch_get_main_queue(), ^{ NSMutableArray *items = [NSMutableArray array]; for (EKReminder *reminder in reminders) [items addObject:itemDTO(entity, reminder)]; ctx->resolve(json(items)); }); }]; return;
    }
    if ([command isEqualToString:@"remove"]) {
      EKCalendar *target = [eventStore() calendarWithIdentifier:string(payload, @"targetId")];
      // 目标消失时，绝不能仅凭旧 locator 删除已被用户移动到另一 Calendar/List 的项目。
      if (!target) { ctx->reject(@"未找到同步目标，拒绝删除系统项目"); return; }
      EKCalendarItem *item = [eventStore() calendarItemWithIdentifier:string(payload, @"calendarItemIdentifier")];
      // calendarItemIdentifier 可在用户移动项目后继续解析；绝不能越过受管目标删除该项目。
      if (item && ![item.calendar.calendarIdentifier isEqualToString:target.calendarIdentifier]) item = nil;
      if (item || !string(payload, @"identity")) { removeItem(entity, item, ctx); return; }
      if ([entity isEqualToString:@"calendar"]) { removeItem(entity, recoveredItem(entity, target, payload), ctx); return; }
      NSPredicate *predicate = [eventStore() predicateForRemindersInCalendars:@[target]];
      [eventStore() fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *reminders) { dispatch_async(dispatch_get_main_queue(), ^{
        NSURL *marker = identityURL(entity, string(payload, @"identity")); EKReminder *match = nil;
        for (EKReminder *reminder in reminders) if ([reminder.URL isEqual:marker]) { match = reminder; break; }
        removeItem(entity, match, ctx);
      }); }];
      return;
    }
    if ([command isEqualToString:@"upsert"] && [entity isEqualToString:@"reminder"] && !string(payload, @"calendarItemIdentifier") && string(payload, @"identity")) { EKCalendar *target = [eventStore() calendarWithIdentifier:string(payload, @"targetId")]; NSPredicate *predicate = target ? [eventStore() predicateForRemindersInCalendars:@[target]] : nil; [eventStore() fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *reminders) { dispatch_async(dispatch_get_main_queue(), ^{ NSURL *marker = identityURL(entity, string(payload, @"identity")); NSMutableArray *matches = [NSMutableArray array]; for (EKReminder *reminder in reminders) if ([reminder.URL isEqual:marker]) [matches addObject:reminder]; upsert(entity, payload, ctx, matches); }); }]; return; }
    if ([command isEqualToString:@"upsert"]) { upsert(entity, payload, ctx, @[]); return; }
    ctx->reject(@"unsupported command");
  }
}

static void cleanupChanges() {
  if (eventStoreChangeObserver) { [[NSNotificationCenter defaultCenter] removeObserver:eventStoreChangeObserver]; eventStoreChangeObserver = nil; }
  if (eventStoreChangeListener) { eventStoreChangeListener->Release(); eventStoreChangeListener.reset(); }
}

static Napi::Value subscribeChanges(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) { Napi::TypeError::New(env, "change listener callback is required").ThrowAsJavaScriptException(); return env.Undefined(); }
  if (eventStoreChangeObserver) [[NSNotificationCenter defaultCenter] removeObserver:eventStoreChangeObserver];
  if (eventStoreChangeListener) eventStoreChangeListener->Release();
  eventStoreChangeListener = std::make_unique<Napi::ThreadSafeFunction>(Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "PromaEventKitChanges", 1, 1));
  eventStoreChangeObserver = [[NSNotificationCenter defaultCenter] addObserverForName:EKEventStoreChangedNotification object:eventStore() queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *) {
    if (!eventStoreChangeListener) return;
    eventStoreChangeListener->NonBlockingCall([](Napi::Env callbackEnv, Napi::Function callback) { callback.Call({}); });
  }];
  return env.Undefined();
}

static Napi::Value command(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env(); if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) { Napi::TypeError::New(env, "command, entity and payload JSON are required").ThrowAsJavaScriptException(); return env.Undefined(); }
  NSString *name = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()]; NSString *entity = [NSString stringWithUTF8String:info[1].As<Napi::String>().Utf8Value().c_str()]; NSString *payloadText = [NSString stringWithUTF8String:info[2].As<Napi::String>().Utf8Value().c_str()];
  NSError *error = nil; NSDictionary *payload = [NSJSONSerialization JSONObjectWithData:[payloadText dataUsingEncoding:NSUTF8StringEncoding] options:0 error:&error]; if (!payload || ![payload isKindOfClass:[NSDictionary class]]) payload = @{};
  auto *ctx = new CommandContext(env); NSLog(@"[PromaEventKit] scheduling %@ for %@ on main queue", name, entity); dispatch_async(dispatch_get_main_queue(), ^{ execute(name, entity, payload, ctx); }); return ctx->deferred->Promise();
}
Napi::Object Init(Napi::Env env, Napi::Object exports) { NSLog(@"[PromaEventKit] N-API addon loaded"); env.AddCleanupHook(cleanupChanges); exports.Set("command", Napi::Function::New(env, command)); exports.Set("subscribeChanges", Napi::Function::New(env, subscribeChanges)); return exports; }
NODE_API_MODULE(proma_eventkit, Init)
