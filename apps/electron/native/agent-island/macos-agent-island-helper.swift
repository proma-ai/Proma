import AppKit
import SwiftUI

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
  let expanded: Bool
  let pill: Pill
  let sessions: [AgentSession]
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

struct SnapshotMessage: Codable {
  let type: String
  let protocolVersion: Int
  let revision: Int
  let state: AgentState
  let planning: Planning

  enum CodingKeys: String, CodingKey {
    case type, revision, state, planning
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
  override var isOpaque: Bool { false }

  required init(rootView: IslandRootView) {
    self.model = rootView.model
    super.init(rootView: rootView)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // This is a defense-in-depth view-level check. IslandController performs the
  // actual WindowServer click-through with `ignoresMouseEvents` outside this rect.
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
    var path = Path()
    path.move(to: CGPoint(x: rect.minX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
    path.addQuadCurve(to: CGPoint(x: rect.maxX - radius, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
    path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
    path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - radius), control: CGPoint(x: rect.minX, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}

func phaseColor(_ phase: String) -> Color {
  switch phase {
  case "running": return Color(red: 1, green: 0.40, blue: 0.05)
  case "needs-interaction": return Color(red: 0, green: 0.84, blue: 0.77)
  case "completed": return Color(red: 0.20, green: 0.80, blue: 0.48)
  case "error": return Color(red: 1, green: 0.35, blue: 0.35)
  default: return Color(red: 0.55, green: 0.65, blue: 1)
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

struct StatusDot: View {
  let phase: String
  var body: some View {
    Circle()
      .fill(phaseColor(phase))
      .frame(width: 8, height: 8)
      .shadow(color: phaseColor(phase).opacity(0.7), radius: 5)
  }
}

struct CompactIslandView: View {
  let snapshot: SnapshotMessage
  let height: CGFloat
  let action: (String, [String: Any]) -> Void

  private var headline: String {
    if let session = snapshot.state.sessions.first { return session.detail.isEmpty ? session.title : session.detail }
    let now = Date().timeIntervalSince1970 * 1000
    if let event = snapshot.planning.events.first(where: { $0.startAt >= now }) {
      return "即将开始 · \(event.title)"
    }
    if let todo = snapshot.planning.todos.first(where: { ($0.dueAt ?? 0) >= now }) {
      return "即将到期 · \(todo.title)"
    }
    return "工作提醒"
  }

  var body: some View {
    let primary = snapshot.state.sessions.first
    Button(action: { action("set-expanded", ["expanded": true]) }) {
      HStack(spacing: 7) {
        StatusDot(phase: primary?.phase ?? "idle")
        Text(headline)
          .font(.system(size: 10.5, weight: .semibold))
          .lineLimit(1)
          .foregroundStyle(.white.opacity(0.92))
        Spacer(minLength: 6)
        Text("\(snapshot.planning.todos.count) 待办 · \(snapshot.planning.events.count) 日程")
          .font(.system(size: 8.5, weight: .medium))
          .monospacedDigit()
          .foregroundStyle(.white.opacity(0.5))
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

  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        // 顶部空白处本身是收起手势；覆盖层位于底部，操作按钮位于上层，不抢夺按钮点击。
        Button(action: { action("set-expanded", ["expanded": false]) }) {
          Color.clear.contentShape(Rectangle())
        }.buttonStyle(.plain)
        HStack(spacing: 10) {
          StatusDot(phase: snapshot.state.sessions.first?.phase ?? "idle")
          VStack(alignment: .leading, spacing: 2) {
            Text(snapshot.state.sessions.isEmpty ? "PROMA · REMINDER" : "PROMA · HANDOFF")
              .font(.system(size: 8, weight: .bold)).tracking(1.1).foregroundStyle(.white.opacity(0.42))
            Text(snapshot.state.sessions.isEmpty ? "即将开始" : "需要你接手")
              .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
          }
          Spacer()
          Button(action: { action("open-main", [:]) }) {
            Image(systemName: "arrow.up.right").frame(width: 26, height: 26)
          }.buttonStyle(IslandButtonStyle())
          Button(action: { action("dismiss", [:]) }) {
            Image(systemName: "xmark").frame(width: 26, height: 26)
          }.buttonStyle(IslandButtonStyle())
        }
        .padding(.horizontal, 18)
      }
      .frame(height: 46)

      if !snapshot.state.sessions.isEmpty {
        Divider().overlay(.white.opacity(0.11))
        VStack(spacing: 5) {
          ForEach(snapshot.state.sessions.prefix(3)) { session in
            Button(action: { action("open-session", ["sessionId": session.sessionId]) }) {
              HStack(spacing: 9) {
                StatusDot(phase: session.phase)
                VStack(alignment: .leading, spacing: 3) {
                  HStack(spacing: 5) {
                    Text(session.title).font(.system(size: 11, weight: .semibold)).lineLimit(1)
                    Text(phaseText(session.phase)).font(.system(size: 8, weight: .bold)).foregroundStyle(phaseColor(session.phase))
                  }
                  Text(session.detail.isEmpty ? "正在等待下一步" : session.detail).font(.system(size: 9.5)).lineLimit(1).foregroundStyle(.white.opacity(0.55))
                }
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(.white.opacity(0.45))
              }
              .padding(.horizontal, 10).frame(height: 43)
              .background(.white.opacity(0.065), in: RoundedRectangle(cornerRadius: 10))
            }.buttonStyle(.plain)
          }
        }.padding(14)
      }

      if !snapshot.planning.todos.isEmpty || !snapshot.planning.events.isEmpty {
        Divider().overlay(.white.opacity(0.11))
        HStack(alignment: .top, spacing: 9) {
        PlanningColumn(title: "今日待办", symbol: "checklist", count: snapshot.planning.todos.count) {
          ForEach(snapshot.planning.todos.prefix(3)) { todo in
            HStack(spacing: 5) {
              RoundedRectangle(cornerRadius: 2).stroke(todo.isOverdue ? Color.red : Color.white.opacity(0.45), lineWidth: 1).frame(width: 9, height: 9)
              Text(todo.title).lineLimit(1)
              Spacer()
              Text(timeText(todo.dueAt)).foregroundStyle(todo.isOverdue ? .red.opacity(0.9) : .white.opacity(0.45))
            }
          }
        }
        PlanningColumn(title: "今日日程", symbol: "calendar", count: snapshot.planning.events.count) {
          ForEach(snapshot.planning.events.prefix(3)) { event in
            HStack(spacing: 5) {
              Text(timeText(event.startAt, allDay: event.allDay)).foregroundStyle(Color(red: 0.62, green: 0.72, blue: 1)).frame(width: 30, alignment: .leading)
              Text(event.title).lineLimit(1)
            }
          }
        }
        }
        .padding(14)
      }
    }
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
      HStack(spacing: 4) {
        Image(systemName: symbol).font(.system(size: 9)).foregroundStyle(Color(red: 0.62, green: 0.72, blue: 1))
        Text(title).font(.system(size: 9, weight: .bold)).foregroundStyle(.white.opacity(0.62))
        Text("\(count)").font(.system(size: 8, weight: .bold)).foregroundStyle(.white.opacity(0.72))
      }
      content.font(.system(size: 9.5)).foregroundStyle(.white.opacity(0.80)).frame(maxWidth: .infinity, alignment: .leading)
      if count == 0 { Text("暂无事项").font(.system(size: 9)).foregroundStyle(.white.opacity(0.40)) }
    }
    .padding(9).frame(maxWidth: .infinity, alignment: .topLeading)
    .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 11))
  }
}

struct IslandRootView: View {
  @ObservedObject var model: IslandModel
  let action: (String, [String: Any]) -> Void

  var body: some View {
    let expanded = model.snapshot?.state.expanded == true
    let shape = NotchSurfaceShape(radius: expanded ? 24 : 16)
    ZStack(alignment: .top) {
      // This is intentionally only the visible surface, not the enclosing panel.
      // The rest of the fixed panel remains transparent and click-through.
      ZStack(alignment: .top) {
        shape.fill(Color.black)
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
      .overlay(alignment: .bottom) {
        Rectangle().fill(.white.opacity(0.10)).frame(height: 1).padding(.horizontal, 18)
      }
      .frame(width: model.surfaceSize.width, height: model.surfaceSize.height, alignment: .top)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .animation(.easeOut(duration: 0.18), value: expanded)
  }
}

@MainActor
final class IslandController {
  private static let maximumWidth: CGFloat = 620
  private static let maximumHeight: CGFloat = 500

  private let model = IslandModel()
  private let panel: AgentIslandPanel
  private var screen: NSScreen
  private var latestMessage: SnapshotMessage?
  private var screenObserver: NSObjectProtocol?
  private var pointerTimer: Timer?
  private var pointerInsideSurface = false

  init() {
    screen = Self.preferredScreen() ?? NSScreen.main ?? NSScreen.screens[0]
    let frame = Self.maximumFrame(for: screen)
    panel = AgentIslandPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.statusWindow)) + 2)
    panel.acceptsMouseMovedEvents = true
    // A fixed transparent window normally swallows mouse input even if hitTest
    // returns nil. Gate it at WindowServer level and turn it on only under surface.
    panel.ignoresMouseEvents = true
    panel.contentView = AgentIslandHostingView(rootView: IslandRootView(model: model, action: emitIntent))
    pointerTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.updatePointerTracking() }
    }
    if let pointerTimer { RunLoop.main.add(pointerTimer, forMode: .common) }
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
    pointerTimer?.invalidate()
  }

  func apply(_ message: SnapshotMessage) {
    latestMessage = message
    layout(message, forceModelUpdate: false)
  }

  func close() { panel.orderOut(nil) }

  private func refreshForDisplayChange() {
    guard let latestMessage else { return }
    layout(latestMessage, forceModelUpdate: true)
  }

  private func layout(_ message: SnapshotMessage, forceModelUpdate: Bool) {
    screen = Self.preferredScreen() ?? NSScreen.main ?? screen
    let metrics = NotchMetrics(screen: screen)

    // Default policy: external / non-notched displays never receive a fake notch
    // overlay. This avoids covering their system menu-bar controls. A future
    // explicit top-bar preference can opt in to a separate fallback surface.
    guard metrics.hasNotch else {
      model.apply(message, screen: screen, surfaceSize: .zero, force: forceModelUpdate)
      panel.ignoresMouseEvents = true
      setPointerInsideSurface(false)
      panel.orderOut(nil)
      return
    }

    let targetPanelFrame = Self.maximumFrame(for: screen)
    if panel.frame != targetPanelFrame {
      // Panel geometry changes only when displays change. Snapshot changes animate
      // entirely inside the stable transparent panel.
      panel.setFrame(targetPanelFrame, display: true, animate: false)
    }

    let expanded = message.state.expanded
    let surfaceWidth = expanded ? min(Self.maximumWidth, screen.frame.width - 32) : metrics.compactWidth
    let surfaceHeight = expanded ? Self.expandedHeight(for: message) : metrics.height
    model.apply(message, screen: screen, surfaceSize: CGSize(width: surfaceWidth, height: surfaceHeight), force: forceModelUpdate)
    if message.state.visible { panel.orderFrontRegardless() } else { panel.orderOut(nil) }
    updatePointerTracking()
  }

  private func updatePointerTracking() {
    guard panel.isVisible, model.isInteractive, let contentView = panel.contentView else {
      panel.ignoresMouseEvents = true
      setPointerInsideSurface(false)
      return
    }
    let inWindow = panel.convertPoint(fromScreen: NSEvent.mouseLocation)
    let inContent = contentView.convert(inWindow, from: nil)
    let inside = model.surfaceRect(in: contentView.bounds).contains(inContent)
    // This is the actual pass-through mechanism: the fixed transparent panel is
    // removed from WindowServer hit testing everywhere except its visible surface.
    panel.ignoresMouseEvents = !inside
    setPointerInsideSurface(inside)
  }

  private func setPointerInsideSurface(_ next: Bool) {
    guard pointerInsideSurface != next else { return }
    pointerInsideSurface = next
    emitIntent("set-hovered", ["hovered": next])
  }

  private static func preferredScreen() -> NSScreen? {
    // Anchor automatic mode on a real hardware notch rather than focus/main-screen
    // heuristics, which are unreliable for a non-activating panel on multi-display
    // setups. This naturally falls back after hot-plug events.
    NSScreen.screens.first(where: { NotchMetrics(screen: $0).hasNotch })
  }

  private static func expandedHeight(for message: SnapshotMessage) -> CGFloat {
    let sessionRows = min(message.state.sessions.count, 3)
    let hasPlanning = !message.planning.todos.isEmpty || !message.planning.events.isEmpty
    let sessionHeight: CGFloat = sessionRows > 0 ? CGFloat(24 + sessionRows * 48) : 0
    let planningHeight: CGFloat = hasPlanning ? 116 : 0
    return min(maximumHeight, 46 + sessionHeight + planningHeight)
  }

  private static func maximumFrame(for screen: NSScreen) -> NSRect {
    let width = min(maximumWidth, screen.frame.width - 32)
    let height = min(maximumHeight, screen.frame.height)
    return NSRect(x: round(screen.frame.midX - width / 2), y: screen.frame.maxY - height, width: width, height: height)
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
