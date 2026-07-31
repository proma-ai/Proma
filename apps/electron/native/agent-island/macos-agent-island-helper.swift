import AppKit
import SwiftUI

// The content only needs to clear the lower curve by its radius plus a small
// optical gap; this is not a large fixed blank area.
private let expandedBottomCornerRadius: CGFloat = 32
private let expandedBottomCornerClearance: CGFloat = 32

// Proma macOS Agent Island native host.
// JSON Lines stdin/stdout protocol: TypeScript owns product state; this process only
// owns AppKit geometry, rendering and constrained pointer intents.

struct AgentSession: Codable, Identifiable {
  let sessionId: String
  let title: String
  let phase: String
  let interactionKind: String?
  let detail: String
  let attention: Bool
  var id: String { sessionId }
}

struct Pill: Codable {
  let priorityStatus: String
  let sessionCount: Int
  let activeSessionCount: Int
  let pendingInteractionCount: Int
  let unreadCompletedCount: Int
}

struct AgentState: Codable {
  let visible: Bool
  let hovered: Bool?
  let expanded: Bool
  let pill: Pill
  let sessions: [AgentSession]
  let recentSessions: [AgentSession]
  let idleDashboard: Bool
  let totalCount: Int
  let updatedAt: Double
}

struct PlanningTodo: Codable, Identifiable {
  let id: String
  let title: String
  let dueAt: Double?
  let priority: String
  let isOverdue: Bool
}

struct PlanningEvent: Codable, Identifiable {
  let id: String
  let title: String
  let startAt: Double
  let endAt: Double?
  let allDay: Bool
}

struct Planning: Codable {
  let dayStart: Double
  let dayEnd: Double
  let todos: [PlanningTodo]
  let events: [PlanningEvent]
  let overdueTodoCount: Int
}

struct PlanQuotaWindow: Codable {
  let windowLabel: String
  let remainingPercent: Double
  let remainingLabel: String?
}

struct PlanQuota: Codable, Identifiable {
  let channelName: String
  let planName: String
  let windows: [PlanQuotaWindow]
  var id: String { "\(channelName):\(planName)" }
}

struct SnapshotMessage: Codable {
  let type: String
  let protocolVersion: Int
  let revision: Int
  let state: AgentState
  let planning: Planning
  let planQuotas: [PlanQuota]

  enum CodingKeys: String, CodingKey {
    case type, revision, state, planning, planQuotas
    case protocolVersion = "protocol"
  }
}

struct ShutdownMessage: Codable { let type: String }

final class AgentIslandPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class AgentIslandHostingView: NSHostingView<IslandRootView> {
  private let model: IslandModel
  private let onHover: (Bool) -> Void
  private var hovering = false
  override var isOpaque: Bool { false }

  required init(rootView: IslandRootView) {
    self.model = rootView.model
    self.onHover = rootView.hover
    super.init(rootView: rootView)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil
    ))
  }

  override func mouseEntered(with event: NSEvent) { updateHover(at: event) }
  override func mouseMoved(with event: NSEvent) { updateHover(at: event) }
  override func mouseExited(with event: NSEvent) { setHover(false) }

  private func updateHover(at event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    setHover(model.isInteractive && model.surfaceRect(in: bounds).contains(point))
  }

  private func setHover(_ next: Bool) {
    guard hovering != next else { return }
    hovering = next
    onHover(next)
  }

  // The interactive NSPanel is now frame-fitted to this exact surface. Keep this
  // check as a final safeguard for the tiny shadow/scale margin around it.
  override func hitTest(_ point: NSPoint) -> NSView? {
    guard model.isInteractive, model.surfaceRect(in: bounds).contains(point) else { return nil }
    return super.hitTest(point)
  }
}

@MainActor
final class IslandModel: ObservableObject {
  @Published var snapshot: SnapshotMessage?
  @Published var hasNotch = false
  @Published var compactHeight: CGFloat = 32
  @Published var compactWidth: CGFloat = 460
  @Published var surfaceSize = CGSize(width: 460, height: 32)
  @Published var isInteractive = false
  private(set) var revision = -1

  func apply(_ next: SnapshotMessage, screen: NSScreen, surfaceSize: CGSize, force: Bool = false) {
    guard next.protocolVersion == 1, force || next.revision > revision else { return }
    revision = next.revision
    snapshot = next
    let metrics = NotchMetrics(screen: screen)
    hasNotch = metrics.hasNotch
    compactHeight = metrics.height
    compactWidth = metrics.compactWidth
    self.surfaceSize = surfaceSize
    isInteractive = next.state.visible
  }

  func surfaceRect(in bounds: CGRect) -> CGRect {
    let width = min(surfaceSize.width, bounds.width)
    let height = min(surfaceSize.height, bounds.height)
    return CGRect(x: floor((bounds.width - width) / 2), y: bounds.maxY - height, width: width, height: height)
  }
}

struct NotchMetrics {
  let hasNotch: Bool
  let width: CGFloat
  let height: CGFloat
  let compactWidth: CGFloat

  init(screen: NSScreen) {
    if #available(macOS 12.0, *),
       let left = screen.auxiliaryTopLeftArea,
       let right = screen.auxiliaryTopRightArea {
      let notch = max(1, right.minX - left.maxX)
      let topInset = screen.safeAreaInsets.top
      hasNotch = topInset > 0
      width = notch
      // On a notched Mac this is the physical safe-area height, not a visual
      // approximation. It keeps the compact island contiguous with the cutout.
      height = topInset
      // Black "ears" make the native panel physically bridge the hardware notch.
      compactWidth = min(screen.frame.width - 32, max(420, notch + 276))
    } else {
      hasNotch = false
      width = 0
      height = 0
      compactWidth = 0
    }
  }
}

struct NotchSurfaceShape: Shape {
  let radius: CGFloat

  func path(in rect: CGRect) -> Path {
    let r = min(radius, rect.width / 2, rect.height)
    // Standard circular Bézier coefficient. Unlike a quadratic approximation,
    // this keeps both tangents continuous through the full lower transition.
    let k: CGFloat = 0.552_284_75
    var path = Path()
    path.move(to: CGPoint(x: rect.minX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
    path.addCurve(
      to: CGPoint(x: rect.maxX - r, y: rect.maxY),
      control1: CGPoint(x: rect.maxX, y: rect.maxY - r + k * r),
      control2: CGPoint(x: rect.maxX - r + k * r, y: rect.maxY)
    )
    path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
    path.addCurve(
      to: CGPoint(x: rect.minX, y: rect.maxY - r),
      control1: CGPoint(x: rect.minX + r - k * r, y: rect.maxY),
      control2: CGPoint(x: rect.minX, y: rect.maxY - r + k * r)
    )
    path.closeSubpath()
    return path
  }
}

/// The expanded island should visually merge into the hardware notch at its
/// top edge. Draw only the sides and continuous lower contour, never a top line.
struct NotchSurfaceOutline: Shape {
  let radius: CGFloat

  func path(in rect: CGRect) -> Path {
    let r = min(radius, rect.width / 2, rect.height)
    let k: CGFloat = 0.552_284_75
    var path = Path()
    path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
    path.addCurve(
      to: CGPoint(x: rect.maxX - r, y: rect.maxY),
      control1: CGPoint(x: rect.maxX, y: rect.maxY - r + k * r),
      control2: CGPoint(x: rect.maxX - r + k * r, y: rect.maxY)
    )
    path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
    path.addCurve(
      to: CGPoint(x: rect.minX, y: rect.maxY - r),
      control1: CGPoint(x: rect.minX + r - k * r, y: rect.maxY),
      control2: CGPoint(x: rect.minX, y: rect.maxY - r + k * r)
    )
    path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
    return path
  }
}

func phaseText(_ phase: String) -> String {
  switch phase {
  case "running": return "执行中"
  case "needs-interaction": return "待处理"
  case "completed": return "已完成"
  case "error": return "需关注"
  default: return "待命"
  }
}

func timeText(_ value: Double?, allDay: Bool = false) -> String {
  guard let value else { return "" }
  if allDay { return "全天" }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "zh_CN")
  formatter.dateFormat = "HH:mm"
  return formatter.string(from: Date(timeIntervalSince1970: value / 1000))
}

struct PlanQuotaCarousel: View {
  let quotas: [PlanQuota]
  private let pageSize = 3

  private func quotaText(_ quota: PlanQuota) -> String {
    quota.windows.map { window in
      "\(window.windowLabel) \(window.remainingLabel ?? "\(Int(window.remainingPercent.rounded()))%")"
    }.joined(separator: " · ")
  }

  var body: some View {
    TimelineView(.periodic(from: .now, by: 5)) { timeline in
      if quotas.isEmpty {
        // Reserve the notch-safe band even when no configured Plan exposes quota.
        Color.clear
      } else {
        let pageCount = Int(ceil(Double(quotas.count) / Double(pageSize)))
        let page = Int(timeline.date.timeIntervalSinceReferenceDate / 5) % pageCount
        let start = page * pageSize
        let visible = Array(quotas.dropFirst(start).prefix(pageSize))
        VStack(alignment: .leading, spacing: 4) {
          Text("剩余额度")
            .font(.system(size: 10.5, weight: .bold))
            .tracking(0.5)
            .foregroundStyle(.white.opacity(0.78))
            .frame(height: 13)
          ForEach(visible) { quota in
            HStack(spacing: 6) {
              Text(quota.channelName)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white.opacity(0.84))
                .lineLimit(1)
              if quota.planName != quota.channelName {
                Text("· \(quota.planName)")
                  .font(.system(size: 9.5, weight: .medium))
                  .foregroundStyle(.white.opacity(0.44))
                  .lineLimit(1)
              }
              Spacer(minLength: 8)
              Text(quotaText(quota))
                .font(.system(size: 9.5, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(1)
            }
            .frame(height: 16)
          }
        }
        .padding(.horizontal, 18)
        .padding(.top, 34)
        .transition(.opacity)
      }
    }
  }
}

struct CompactIslandView: View {
  let snapshot: SnapshotMessage
  let height: CGFloat
  let action: (String, [String: Any]) -> Void

  private var primarySession: AgentSession? { snapshot.state.sessions.first }

  private var planningIndicator: (symbol: String, label: String, color: Color)? {
    let now = Date().timeIntervalSince1970 * 1000
    let imminentEnd = now + 60 * 60 * 1000
    let nextEvent = snapshot.planning.events.first(where: { $0.startAt >= now && $0.startAt <= imminentEnd })
    let nextTodo = snapshot.planning.todos.first(where: { ($0.dueAt ?? 0) >= now && ($0.dueAt ?? 0) <= imminentEnd })
    switch (nextEvent, nextTodo) {
    case let (.some(event), .some(todo)):
      return event.startAt <= (todo.dueAt ?? Double.greatestFiniteMagnitude)
        ? ("calendar", "即将日程", Color(red: 0.62, green: 0.72, blue: 1))
        : ("checklist", "即将到期", Color(red: 1, green: 0.66, blue: 0.22))
    case (.some, .none):
      return ("calendar", "即将日程", Color(red: 0.62, green: 0.72, blue: 1))
    case (.none, .some):
      return ("checklist", "即将到期", Color(red: 1, green: 0.66, blue: 0.22))
    case (.none, .none):
      return nil
    }
  }

  private var compactLabel: String {
    if let session = primarySession {
      return "Proma · \(phaseText(session.phase))"
    }
    if !snapshot.state.recentSessions.isEmpty {
      return "Proma · 最近会话"
    }
    return planningIndicator?.label ?? "工作提醒"
  }

  var body: some View {
    Button(action: { action("set-expanded", ["expanded": true]) }) {
      HStack(spacing: 8) {
        if primarySession == nil, let indicator = planningIndicator {
          Image(systemName: indicator.symbol)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(indicator.color)
            .frame(width: 14)
        } else if primarySession == nil {
          Image(systemName: "bell")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.white.opacity(0.65))
            .frame(width: 14)
        }
        Text(compactLabel)
          .font(.system(size: 10.5, weight: .semibold))
          .lineLimit(1)
          .foregroundStyle(.white.opacity(0.92))
        Spacer(minLength: 6)
        Image(systemName: "chevron.down")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(.white.opacity(0.46))
      }
      .padding(.horizontal, 14)
      .frame(height: height)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

struct Metric: View {
  let value: Int
  let label: String
  var body: some View {
    HStack(spacing: 3) {
      Text("\(value)").font(.system(size: 10, weight: .bold))
      Text(label).font(.system(size: 8.5, weight: .medium))
    }
    .foregroundStyle(.white.opacity(0.72))
    .padding(.horizontal, 6).padding(.vertical, 4)
    .background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 6))
  }
}

struct ExpandedIslandView: View {
  let snapshot: SnapshotMessage
  let action: (String, [String: Any]) -> Void

  private var primaryPhase: String? { snapshot.state.sessions.first?.phase }
  private var isPersistentRecentDashboard: Bool {
    snapshot.state.idleDashboard
  }
  private var displayedSessions: [AgentSession] {
    isPersistentRecentDashboard ? snapshot.state.recentSessions : snapshot.state.sessions
  }
  private var contentMode: String {
    if !snapshot.state.sessions.isEmpty { return "live" }
    if isPersistentRecentDashboard { return "recent" }
    return "planning"
  }

  private var headerEyebrow: String {
    switch primaryPhase {
    case "needs-interaction": return "PROMA · HANDOFF"
    case .some: return "PROMA · AGENT"
    case .none: return "PROMA · REMINDER"
    }
  }

  private var headerTitle: String {
    switch primaryPhase {
    case "running": return "正在执行"
    case "needs-interaction": return "需要你接手"
    case "completed": return "任务已完成"
    case "error": return "执行需要关注"
    case .some: return "Agent 状态更新"
    case .none: return "即将开始"
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      // 计划是唯一内容时，直接展示可操作的信息卡；不再浪费一行
      // “即将开始”标题。Agent 会话存在时才保留状态头与打开入口。
      if !snapshot.state.sessions.isEmpty {
        ZStack {
          // 顶部空白处本身是收起手势；覆盖层位于底部，操作按钮位于上层，不抢夺按钮点击。
          Button(action: { action("set-expanded", ["expanded": false]) }) {
            Color.clear.contentShape(Rectangle())
          }.buttonStyle(.plain)
          HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
              Text(headerEyebrow)
                .font(.system(size: 9, weight: .bold)).tracking(1.1).foregroundStyle(.white.opacity(0.62))
              Text(headerTitle)
                .font(.system(size: 15.5, weight: .bold)).foregroundStyle(.white.opacity(0.98))
            }
            Spacer()
            Button(action: { action("open-main", [:]) }) {
              HStack(spacing: 5) {
                Text("打开 Proma")
                Image(systemName: "arrow.up.right")
              }
              .font(.system(size: 10, weight: .semibold))
              .padding(.horizontal, 9)
              .frame(height: 26)
            }.buttonStyle(IslandButtonStyle())
          }
          .padding(.horizontal, 18)
        }
        .frame(height: 46)
      } else {
        // The compact notch is a real physical exclusion zone. Keep planning
        // content below it and use that otherwise-empty band for Plan usage.
        PlanQuotaCarousel(quotas: snapshot.planQuotas)
          .frame(height: snapshot.planQuotas.isEmpty ? 56 : 108)
      }

      if !displayedSessions.isEmpty {
        Divider().overlay(.white.opacity(0.11))
        VStack(alignment: .leading, spacing: 5) {
          if isPersistentRecentDashboard {
            Text("最近 Agent")
              .font(.system(size: 11, weight: .bold))
              .foregroundStyle(.white.opacity(0.78))
              .padding(.horizontal, 4)
              .padding(.bottom, 2)
          }
          ForEach(displayedSessions.prefix(3)) { session in
            Button(action: { action("open-session", ["sessionId": session.sessionId]) }) {
              HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                  // The island reports a human-readable phase, rather than the
                  // rapidly changing tool stream that created it.
                  Text(phaseText(session.phase))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.98))
                  Text(session.title)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.62))
                }
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(.white.opacity(0.45))
              }
              .padding(.horizontal, 11).frame(height: 46)
              .background(.white.opacity(0.065), in: RoundedRectangle(cornerRadius: 10))
            }.buttonStyle(.plain)
          }
        }.padding(14)
      }

      if !isPersistentRecentDashboard && (!snapshot.planning.todos.isEmpty || !snapshot.planning.events.isEmpty) {
        if !displayedSessions.isEmpty {
          Divider().overlay(.white.opacity(0.11))
        }
        HStack(alignment: .top, spacing: 12) {
          if !snapshot.planning.todos.isEmpty {
            Button(action: { action("open-planning", [:]) }) {
              PlanningColumn(title: "接下来待办", symbol: "checklist", count: snapshot.planning.todos.count) {
                ForEach(snapshot.planning.todos.prefix(3)) { todo in
                  HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2.5).stroke(todo.isOverdue ? Color.red : Color.white.opacity(0.5), lineWidth: 1.2).frame(width: 11, height: 11)
                    Text(todo.title).lineLimit(1)
                    Spacer()
                    Text(timeText(todo.dueAt)).foregroundStyle(todo.isOverdue ? .red.opacity(0.9) : .white.opacity(0.5))
                  }
                  .frame(height: 20)
                }
              }
            }.buttonStyle(.plain)
          }
          if !snapshot.planning.events.isEmpty {
            Button(action: { action("open-planning", [:]) }) {
              PlanningColumn(title: "接下来日程", symbol: "calendar", count: snapshot.planning.events.count) {
                ForEach(snapshot.planning.events.prefix(3)) { event in
                  HStack(spacing: 6) {
                    Text(timeText(event.startAt, allDay: event.allDay)).foregroundStyle(Color(red: 0.62, green: 0.72, blue: 1)).frame(width: 36, alignment: .leading)
                    Text(event.title).lineLimit(1)
                  }
                  .frame(height: 20)
                }
              }
            }.buttonStyle(.plain)
          }
        }
        .padding(14)
      }
    }
    // A small optical inset keeps the content from feeling attached to the
    // hardware notch, while the lower inset protects the continuous curve.
    .padding(.top, 8)
    .padding(.bottom, expandedBottomCornerClearance)
    // Replace the live Agent stack and the idle recent-session dashboard as
    // distinct views, so a completion feels like a calm handoff, not a cut.
    .id(contentMode)
    .transition(.asymmetric(
      insertion: .opacity.combined(with: .move(edge: .top)),
      removal: .opacity.combined(with: .move(edge: .bottom))
    ))
    .animation(.easeInOut(duration: 0.36), value: contentMode)
  }
}

struct IslandButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(.white.opacity(configuration.isPressed ? 0.55 : 0.75))
      .background(.white.opacity(configuration.isPressed ? 0.14 : 0.07), in: RoundedRectangle(cornerRadius: 8))
  }
}

struct PlanningColumn<Content: View>: View {
  let title: String
  let symbol: String
  let count: Int
  @ViewBuilder let content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 5) {
        Image(systemName: symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color(red: 0.62, green: 0.72, blue: 1))
        Text(title).font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.9))
        Text("\(count)").font(.system(size: 10.5, weight: .bold)).foregroundStyle(.white.opacity(0.88))
      }
      content.font(.system(size: 11)).foregroundStyle(.white.opacity(0.86)).frame(maxWidth: .infinity, alignment: .leading)
      if count == 0 { Text("暂无事项").font(.system(size: 10.5)).foregroundStyle(.white.opacity(0.45)) }
    }
    .padding(13).frame(maxWidth: .infinity, alignment: .topLeading)
    .compositingGroup()
    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    .background(.white.opacity(0.075), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(.white.opacity(0.10), lineWidth: 1))
  }
}

struct IslandRootView: View {
  @ObservedObject var model: IslandModel
  let action: (String, [String: Any]) -> Void
  let hover: (Bool) -> Void

  var body: some View {
    let expanded = model.snapshot?.state.expanded == true
    let hovered = model.snapshot?.state.hovered == true
    // A deliberately generous lower radius makes the expanded island read as
    // one continuous macOS surface, even against a black desktop wallpaper.
    let cornerRadius = expanded ? expandedBottomCornerRadius : (hovered ? 18 : 16)
    let shape = NotchSurfaceShape(radius: cornerRadius)
    let outline = NotchSurfaceOutline(radius: cornerRadius)
    ZStack(alignment: .top) {
      // This is intentionally only the visible surface, not the enclosing panel.
      // The rest of the fixed panel remains transparent and click-through.
      ZStack(alignment: .top) {
        shape.fill(expanded
          ? Color(red: 0.035, green: 0.035, blue: 0.035)
          : Color.black)
        if let snapshot = model.snapshot, snapshot.state.visible {
          if snapshot.state.expanded {
            ExpandedIslandView(snapshot: snapshot, action: action)
              .transition(.opacity.combined(with: .move(edge: .top)))
          } else {
            CompactIslandView(snapshot: snapshot, height: model.compactHeight, action: action)
              .transition(.opacity)
          }
        }
      }
      .compositingGroup()
      .clipShape(shape)
      .overlay {
        // Keep the expanded silhouette legible against a dark desktop so its
        // lower continuous corners do not disappear into the background.
        if expanded {
          ZStack {
            // A soft outer pass first, then a crisp inner edge: the result
            // reads as one rounded macOS surface instead of a hard rectangle.
            outline.stroke(.white.opacity(0.08), lineWidth: 3)
            outline.stroke(.white.opacity(0.20), lineWidth: 1.2)
          }
        } else if hovered {
          shape.stroke(.white.opacity(0.15), lineWidth: 1)
        }
      }
      .overlay(alignment: .bottom) {
        // The compact notch keeps its subtle underline; the expanded surface
        // relies on its rounded silhouette instead of ending in a hard line.
        if !expanded {
          Rectangle().fill(.white.opacity(hovered ? 0.16 : 0.10)).frame(height: 1).padding(.horizontal, 18)
        }
      }
      .shadow(color: .black.opacity(hovered && !expanded ? 0.42 : 0.26), radius: hovered && !expanded ? 10 : 5, y: hovered && !expanded ? 3 : 1)
      .scaleEffect(hovered && !expanded ? 1.012 : 1, anchor: .top)
      .frame(width: model.surfaceSize.width, height: model.surfaceSize.height, alignment: .top)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .animation(.timingCurve(0.2, 0, 0, 1, duration: 0.16), value: hovered)
    .animation(.timingCurve(0.2, 0, 0, 1, duration: 0.22), value: expanded)
  }
}

@MainActor
final class IslandController {
  private static let maximumWidth: CGFloat = 620
  // Large enough that lower contour clearance, not an arbitrary panel cap,
  // determines the expanded layout for current 3-session + 4+4 planning data.
  private static let maximumHeight: CGFloat = 640

  private let model = IslandModel()
  private let panel: AgentIslandPanel
  private var screen: NSScreen
  private var latestMessage: SnapshotMessage?
  private var screenObserver: NSObjectProtocol?

  init() {
    screen = Self.preferredScreen() ?? NSScreen.main ?? NSScreen.screens[0]
    let metrics = NotchMetrics(screen: screen)
    panel = AgentIslandPanel(
      contentRect: Self.topFrame(screen: screen, width: max(metrics.compactWidth, 1), height: max(metrics.height, 1)),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.statusWindow)) + 2)
    panel.acceptsMouseMovedEvents = true
    panel.ignoresMouseEvents = true
    let hosting = AgentIslandHostingView(rootView: IslandRootView(
      model: model,
      action: emitIntent,
      hover: { hovered in emitIntent("set-hovered", ["hovered": hovered]) }
    ))
    panel.contentView = hosting
    screenObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { @MainActor in self?.refreshForDisplayChange() }
    }
  }

  deinit {
    if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
  }

  func apply(_ message: SnapshotMessage) {
    let animateExpandedResize = latestMessage?.state.expanded == true
      && message.state.expanded
      && latestMessage?.state.visible == true
      && message.state.visible
    latestMessage = message
    layout(message, forceModelUpdate: false, animateFrame: animateExpandedResize)
  }

  func close() { panel.orderOut(nil) }

  private func refreshForDisplayChange() {
    guard let latestMessage else { return }
    layout(latestMessage, forceModelUpdate: true)
  }

  private func layout(_ message: SnapshotMessage, forceModelUpdate: Bool, animateFrame: Bool = false) {
    screen = Self.preferredScreen() ?? NSScreen.main ?? screen
    let metrics = NotchMetrics(screen: screen)

    // Never fake a notch on an external screen. A hidden panel also remains fully
    // click-through, so it cannot cover system menu-bar controls.
    guard metrics.hasNotch else {
      model.apply(message, screen: screen, surfaceSize: .zero, force: forceModelUpdate)
      panel.ignoresMouseEvents = true
      panel.orderOut(nil)
      return
    }

    let expanded = message.state.expanded
    let width = expanded ? min(Self.maximumWidth, screen.frame.width - 32) : metrics.compactWidth
    let height = expanded ? Self.expandedHeight(for: message, width: width) : metrics.height
    let surfaceSize = CGSize(width: width, height: height)

    // Best practice from CC Island/Open Vibe Island: fit the NSPanel to the real
    // interactive surface. This avoids a giant transparent WindowServer hit area,
    // so native AppKit hover and clicks stay immediate without event replays.
    let targetFrame = Self.topFrame(screen: screen, width: width, height: height)
    if panel.frame != targetFrame {
      if animateFrame {
        NSAnimationContext.runAnimationGroup { context in
          context.duration = 0.36
          panel.animator().setFrame(targetFrame, display: true)
        }
      } else {
        panel.setFrame(targetFrame, display: true, animate: false)
      }
    }
    model.apply(message, screen: screen, surfaceSize: surfaceSize, force: forceModelUpdate)
    panel.ignoresMouseEvents = !message.state.visible
    panel.acceptsMouseMovedEvents = message.state.visible
    if message.state.visible { panel.orderFrontRegardless() } else { panel.orderOut(nil) }
  }

  private static func preferredScreen() -> NSScreen? {
    NSScreen.screens.first(where: { NotchMetrics(screen: $0).hasNotch })
  }

  private static func expandedHeight(for message: SnapshotMessage, width: CGFloat) -> CGFloat {
    // Measure the exact same SwiftUI tree used by the visible surface at its
    // final width. This avoids a second resize after hover while also avoiding
    // fragile hand-written font/padding arithmetic that can cut off the curve.
    let measuringView = NSHostingView(rootView:
      ExpandedIslandView(snapshot: message, action: { _, _ in })
        .frame(width: width, alignment: .topLeading)
        .fixedSize(horizontal: false, vertical: true)
    )
    let height = ceil(measuringView.fittingSize.height)
    return min(maximumHeight, max(height, 1))
  }

  private static func topFrame(screen: NSScreen, width: CGFloat, height: CGFloat) -> NSRect {
    NSRect(x: round(screen.frame.midX - width / 2), y: screen.frame.maxY - height, width: width, height: height)
  }
}

func emitJson(_ object: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(object), let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func emitIntent(_ name: String, _ values: [String: Any]) {
  var payload: [String: Any] = ["type": "intent", "name": name]
  values.forEach { payload[$0.key] = $0.value }
  emitJson(payload)
}

@main
@MainActor
struct PromaAgentIslandHost {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let controller = IslandController()
    emitJson(["type": "ready", "protocol": 1])

    DispatchQueue.global(qos: .userInitiated).async {
      while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8),
              let type = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["type"] as? String else { continue }
        if type == "shutdown" {
          DispatchQueue.main.async { controller.close(); app.terminate(nil) }
          return
        }
        if type == "snapshot", let message = try? JSONDecoder().decode(SnapshotMessage.self, from: data) {
          DispatchQueue.main.async { controller.apply(message) }
        }
      }
      DispatchQueue.main.async { controller.close(); app.terminate(nil) }
    }
    app.run()
  }
}
