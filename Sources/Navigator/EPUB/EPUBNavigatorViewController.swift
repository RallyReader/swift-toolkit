//
//  Copyright 2026 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import ReadiumInternal
import ReadiumShared
import SafariServices
import SwiftSoup
import UIKit
import WebKit

@MainActor public protocol EPUBNavigatorDelegate: VisualNavigatorDelegate, SelectableNavigatorDelegate,
    ViewportObservingNavigatorDelegate
{
    // MARK: - WebView Customization

    func navigator(_ navigator: EPUBNavigatorViewController, setupUserScripts userContentController: WKUserContentController)

    // MARK: - Rally

    /// Rally: a spread finished loading and its stored decorations were re-added; called once per resource.
    func spreadViewDidLoad(href: AnyURL)

    /// Rally: the user will begin dragging the content.
    func navigatorScrollViewWillBeginDragging(_ navigator: EPUBNavigatorViewController)

    /// Rally: the content did end decelerating.
    func navigatorScrollViewDidEndDecelerating(_ navigator: EPUBNavigatorViewController)
}

public extension EPUBNavigatorDelegate {
    func navigator(_ navigator: EPUBNavigatorViewController, setupUserScripts userContentController: WKUserContentController) {}

    func spreadViewDidLoad(href: AnyURL) {}
    func navigatorScrollViewWillBeginDragging(_ navigator: EPUBNavigatorViewController) {}
    func navigatorScrollViewDidEndDecelerating(_ navigator: EPUBNavigatorViewController) {}
}

public typealias EPUBContentInsets = (top: CGFloat, bottom: CGFloat)

open class EPUBNavigatorViewController: InputObservableViewController,
    VisualNavigator, ViewportObservingNavigator, SelectableNavigator,
    DecorableNavigator, Configurable, Loggable
{
    public enum EPUBError: Error {
        /// The provided publication is restricted. Check that any DRM was
        /// properly unlocked using a Content Protection.
        case publicationRestricted

        /// Returned when calling evaluateJavaScript() before a resource is
        /// loaded.
        case spreadNotLoaded

        /// Failed to serve the publication or assets with the provided HTTP
        /// server.
        @available(*, deprecated, message: "The HTTP server is no longer needed for the EPUB navigator.")
        case serverFailure(Error)
    }

    public struct Configuration {
        /// Initial set of setting preferences.
        public var preferences: EPUBPreferences

        /// Provides default fallback values and ranges for the user settings.
        public var defaults: EPUBDefaults

        /// Editing actions which will be displayed in the default text selection menu.
        ///
        /// The default set of editing actions is `EditingAction.defaultActions`.
        ///
        /// You can provide custom actions with `EditingAction(title: "Highlight", action: #selector(highlight:))`.
        /// Then, implement the selector in one of your classes in the responder chain. Typically, in the
        /// `UIViewController` wrapping the `EPUBNavigatorViewController`.
        public var editingActions: [EditingAction]

        /// Disables horizontal page turning when scroll is enabled.
        public var disablePageTurnsWhileScrolling: Bool

        /// Content insets used to add some vertical margins around reflowable
        /// EPUB publications. Note that the margins include the safe area
        /// insets. To avoid any "jump" when toggling the status bar, provide
        /// values large enough.
        ///
        /// The insets can be configured for each size class to allow smaller
        /// margins on compact screens.
        ///
        /// For more control, implement the `navigatorContentInset()` delegate
        /// method, which takes precedence over this configuration property
        /// when implemented.
        public var contentInset: [UIUserInterfaceSizeClass: EPUBContentInsets]

        /// Number of positions (as in `Publication.positionList`) to preload before the current page.
        public var preloadPreviousPositionCount: Int

        /// Number of positions (as in `Publication.positionList`) to preload after the current page.
        public var preloadNextPositionCount: Int

        /// Supported HTML decoration templates.
        public var decorationTemplates: [Decoration.Style.Id: HTMLDecorationTemplate]

        /// Additional font families which will be available in the preferences.
        public var fontFamilyDeclarations: [AnyHTMLFontFamilyDeclaration]

        /// Readium CSS reading system settings.
        ///
        /// See https://readium.org/readium-css/docs/CSS19-api.html#reading-system-styles
        public var readiumCSSRSProperties: CSSRSProperties

        /// Logs the state changes when true.
        public var debugState: Bool

        public init(
            preferences: EPUBPreferences = .empty,
            defaults: EPUBDefaults = EPUBDefaults(),
            editingActions: [EditingAction] = EditingAction.defaultActions,
            disablePageTurnsWhileScrolling: Bool = false,
            contentInset: [UIUserInterfaceSizeClass: EPUBContentInsets] = [
                .compact: (top: 34, bottom: 34),
                .regular: (top: 62, bottom: 62),
            ],
            preloadPreviousPositionCount: Int = 2,
            preloadNextPositionCount: Int = 6,
            decorationTemplates: [Decoration.Style.Id: HTMLDecorationTemplate] = HTMLDecorationTemplate.defaultTemplates(),
            fontFamilyDeclarations: [AnyHTMLFontFamilyDeclaration] = [],
            readiumCSSRSProperties: CSSRSProperties = CSSRSProperties(),
            debugState: Bool = false
        ) {
            self.preferences = preferences
            self.defaults = defaults
            self.editingActions = editingActions
            self.disablePageTurnsWhileScrolling = disablePageTurnsWhileScrolling
            self.contentInset = contentInset
            self.preloadPreviousPositionCount = preloadPreviousPositionCount
            self.preloadNextPositionCount = preloadNextPositionCount
            self.decorationTemplates = decorationTemplates
            self.fontFamilyDeclarations = fontFamilyDeclarations
            self.readiumCSSRSProperties = readiumCSSRSProperties
            self.debugState = debugState
        }

        func contentInset(for sizeClass: UIUserInterfaceSizeClass) -> EPUBContentInsets {
            contentInset[sizeClass]
                ?? contentInset[.regular]
                ?? contentInset[.unspecified]
                ?? (top: 0, bottom: 0)
        }
    }

    public weak var delegate: EPUBNavigatorDelegate?

    /// Information about the visible portion of the publication, when rendered.
    public private(set) var viewport: NavigatorViewport? {
        didSet {
            if oldValue != viewport {
                delegate?.navigator(self, viewportDidChange: viewport)
            }
        }
    }

    @available(*, deprecated, renamed: "NavigatorViewport")
    public typealias Viewport = NavigatorViewport

    /// Navigation state.
    private enum State: Equatable {
        /// Initializing the navigator.
        case initializing
        /// Loading the spreads at the `pendingLocator`, for example after
        /// changing the user settings, rotating the screen or loading the
        /// publication.
        case loading(pendingLocator: Locator?)
        /// Waiting for further navigation instructions.
        case idle
        /// Jumping to `pendingLocator`.
        case jumping(pendingLocator: Locator)
        /// Turning the page in the given `direction`.
        case moving(direction: EPUBSpreadView.Direction)

        var pendingLocator: Locator? {
            switch self {
            case let .loading(pendingLocator: locator):
                return locator
            case let .jumping(pendingLocator: locator):
                return locator
            default:
                return nil
            }
        }

        mutating func transition(_ event: Event) -> Bool {
            switch (self, event) {
            // Loading the spreads is always possible, because it can be triggered by rotating the
            // screen. In which case it cancels any on-going state.
            case let (_, .load(locator)):
                self = .loading(pendingLocator: locator)

            // All events are ignored when loading spreads, except for `loaded` and `load`.
            case (.loading, .loaded):
                self = .idle

            case (.loading, _):
                return false

            case let (.idle, .jump(locator)):
                self = .jumping(pendingLocator: locator)

            case let (.idle, .move(direction)):
                self = .moving(direction: direction)

            case (.jumping, .jumped):
                self = .idle

            // Moving or jumping to another locator is not allowed during a pending jump.
            case (.jumping, .jump),
                 (.jumping, .move):
                return false

            case (.moving, .moved):
                self = .idle

            // Moving or jumping to another locator is not allowed during a pending move.
            case (.moving, .jump),
                 (.moving, .move):
                return false

            default:
                log(.error, "Invalid event \(event) for state \(self)")
                return false
            }

            return true
        }
    }

    /// Navigation event.
    private enum Event: Equatable {
        /// Load the spreads at the given locator, for example after changing
        /// the user settings, rotating the screen or loading the publication.
        case load(Locator?)
        /// The spreads were loaded.
        case loaded
        /// Jump to the given locator.
        case jump(Locator)
        /// Finished jumping to a locator.
        case jumped
        /// Turn the page in the given direction.
        case move(EPUBSpreadView.Direction)
        /// Finished turning the page.
        case moved
    }

    /// Current navigation state.
    private var state: State = .initializing {
        didSet {
            if config.debugState {
                log(.debug, "* \(state)")
            }

            // Disable user interaction while transitioning, to avoid UX issues.
            switch state {
            case .initializing, .loading, .jumping, .moving:
                paginationView?.isUserInteractionEnabled = false
            case .idle:
                paginationView?.isUserInteractionEnabled = true
            }
        }
    }

    private let readingOrder: [Link]
    public private(set) var currentLocation: Locator?
    private let loadPositionsByReadingOrder: () async -> ReadResult<[[Locator]]>
    private var positionsByReadingOrder: [[Locator]] = []

    private let viewModel: EPUBNavigatorViewModel
    public var publication: Publication {
        viewModel.publication
    }

    var config: Configuration {
        viewModel.config
    }

    /// Creates a new instance of `EPUBNavigatorViewController`.
    ///
    /// - Parameters:
    ///   - publication: EPUB publication to render.
    ///   - initialLocation: Starting location in the publication, defaults to
    ///   the beginning.
    ///   - readingOrder: Custom order of resources to display. Used for example
    ///   to display a non-linear resource on its own.
    ///   - config: Additional navigator configuration.
    public convenience init(
        publication: Publication,
        initialLocation: Locator?,
        readingOrder: [Link]? = nil,
        config: Configuration = .init()
    ) throws {
        precondition(readingOrder.map { !$0.isEmpty } ?? true)

        guard !publication.isRestricted else {
            throw EPUBError.publicationRestricted
        }

        let viewModel = EPUBNavigatorViewModel(
            publication: publication,
            readingOrder: readingOrder ?? publication.readingOrder,
            config: config
        )

        self.init(
            viewModel: viewModel,
            initialLocation: initialLocation,
            readingOrder: viewModel.readingOrder,
            positionsByReadingOrder:
            // Positions and total progression only make sense in the context
            // of the publication's actual reading order. Therefore when
            // provided with a different reading order, we should assume the
            // positions list is empty, and also not compute the
            // totalProgression when calculating the current locator.
            (readingOrder != nil) ? { .success([]) } : publication.positionsByReadingOrder
        )
    }

    /// Creates a new instance of `EPUBNavigatorViewController`.
    @available(*, deprecated, message: "The HTTP server is no longer needed for the EPUB navigator.")
    public convenience init(
        publication: Publication,
        initialLocation: Locator?,
        readingOrder: [Link]? = nil,
        config: Configuration = .init(),
        httpServer: HTTPServer
    ) throws {
        try self.init(
            publication: publication,
            initialLocation: initialLocation,
            readingOrder: readingOrder,
            config: config
        )
    }

    private init(
        viewModel: EPUBNavigatorViewModel,
        initialLocation: Locator?,
        readingOrder: [Link],
        positionsByReadingOrder: @escaping () async -> ReadResult<[[Locator]]>
    ) {
        self.viewModel = viewModel
        currentLocation = initialLocation
        self.readingOrder = readingOrder
        loadPositionsByReadingOrder = positionsByReadingOrder

        super.init(nibName: nil, bundle: nil)

        viewModel.delegate = self
        viewModel.editingActions.delegate = self

        setupLegacyInputCallbacks(
            onTap: { [weak self] point in
                guard let self else { return }
                self.delegate?.navigator(self, didTapAt: point)
            },
            onPressKey: { [weak self] event in
                guard let self else { return }
                self.delegate?.navigator(self, didPressKey: event)
            },
            onReleaseKey: { [weak self] event in
                guard let self else { return }
                self.delegate?.navigator(self, didReleaseKey: event)
            }
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(willResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
    }

    @available(*, unavailable)
    public required init?(coder aDecoder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override open func viewDidLoad() {
        super.viewDidLoad()

        // Will call `accessibilityScroll()` when VoiceOver reaches the end of
        // the current resource. We can use this to go to the next resource.
        view.accessibilityTraits.insert(.causesPageTurn)

        Task {
            await initialize()
        }
    }

    private var isActive = true

    @objc private func willResignActive() {
        isActive = false
    }

    @objc private func didBecomeActive() {
        isActive = true

        // The device may have rotated since the last time the app was active.
        // We may need to refresh the spreads in this situation. Unfortunately,
        // the `viewWillTransition(to:with:)` API is called before we receive
        // the `didBecomeActive` notification, so we cannot rely on it here.
        viewModel.viewSizeWillChange(view.bounds.size)

        if needsReloadSpreadsOnActive {
            needsReloadSpreadsOnActive = false
            reloadSpreads()
        }
    }

    private func initialize() async {
        do {
            positionsByReadingOrder = try await loadPositionsByReadingOrder().get()
        } catch {
            log(.error, DebugError("Failed to load positions.", cause: error))
        }

        paginationView = makePaginationView(
            hasPositions: !positionsByReadingOrder.isEmpty
        )

        paginationView!.frame = view.bounds
        paginationView!.autoresizingMask = [.flexibleHeight, .flexibleWidth]
        view.addSubview(paginationView!)

        applySettings()

        _reloadSpreads()

        onInitializedCallbacks.complete()
    }

    private let onInitializedCallbacks = CompletionList()

    private func initialized() async {
        await withCheckedContinuation { continuation in
            whenInitialized {
                continuation.resume()
            }
        }
    }

    private func whenInitialized(_ callback: @escaping () -> Void) {
        let callback = onInitializedCallbacks.add(callback)
        if state != .initializing {
            callback()
        }
    }

    @available(iOS 13.0, *)
    override open func buildMenu(with builder: UIMenuBuilder) {
        // Rally: after super, so the system menus it adds are removed.
        super.buildMenu(with: builder)
        viewModel.editingActions.buildMenu(with: builder)
    }

    override open func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        viewModel.viewSizeWillChange(view.bounds.size)
    }

    override open func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)

        if isActive {
            viewModel.viewSizeWillChange(size)
        }
    }

    @discardableResult
    private func on(_ event: Event) -> Bool {
        assert(Thread.isMainThread, "Raising navigation events must be done from the main thread")

        if config.debugState {
            log(.debug, "-> on \(event)")
        }

        return state.transition(event)
    }

    /// Mapping between reading order hrefs and the table of contents title.
    private var tableOfContentsTitleByHref: [AnyURL: String] {
        get async { await tableOfContentsTitleByHrefTask.value }
    }

    private lazy var tableOfContentsTitleByHrefTask: Task<[AnyURL: String], Never> = Task {
        func fulfill(linkList: [Link]) -> [AnyURL: String] {
            var result = [AnyURL: String]()

            for link in linkList {
                if let title = link.title {
                    result[link.url()] = title
                }
                let subResult = fulfill(linkList: link.children)
                result.merge(subResult) { current, _ -> String in
                    current
                }
            }
            return result
        }

        guard let toc = try? await publication.tableOfContents().get() else {
            return [:]
        }

        return fulfill(linkList: toc)
    }

    /// Goes to the next or previous page in the given scroll direction.
    private func go(to direction: EPUBSpreadView.Direction, options: NavigatorGoOptions) async -> Bool {
        guard
            let paginationView = paginationView,
            on(.move(direction))
        else {
            return false
        }

        if
            let spreadView = paginationView.currentView as? EPUBSpreadView,
            await spreadView.go(to: direction, options: options)
        {
            on(.moved)
            return true
        }

        let isRTL = (viewModel.readingProgression == .rtl)
        let delta = isRTL ? -1 : 1
        let moved: Bool = await {
            switch direction {
            case .left:
                let location: PageLocation = isRTL ? .start : .end
                return await paginationView.goToIndex(currentSpreadIndex - delta, location: location, options: options)
            case .right:
                let location: PageLocation = isRTL ? .end : .start
                return await paginationView.goToIndex(currentSpreadIndex + delta, location: location, options: options)
            }
        }()

        on(.moved)
        return moved
    }

    // MARK: - Pagination and spreads

    private var paginationView: PaginationView?

    private func makePaginationView(hasPositions: Bool) -> PaginationView {
        let view = PaginationView(
            frame: .zero,
            preloadPreviousPositionCount: hasPositions ? config.preloadPreviousPositionCount : 0,
            preloadNextPositionCount: hasPositions ? config.preloadNextPositionCount : 0,
            isScrollEnabled: isPaginationViewScrollingEnabled
        )
        view.delegate = self
        view.backgroundColor = .clear
        return view
    }

    private func invalidatePaginationView() {
        guard let paginationView = paginationView else {
            return
        }

        paginationView.isScrollEnabled = isPaginationViewScrollingEnabled
        reloadSpreads()
    }

    private var spreads: [EPUBSpread] = []

    /// Index of the currently visible spread.
    private var currentSpreadIndex: Int {
        paginationView?.currentIndex ?? 0
    }

    private var needsReloadSpreadsOnActive = false

    private func reloadSpreads() {
        guard
            state != .initializing,
            isViewLoaded
        else {
            return
        }

        guard isActive else {
            // If we reload the spreads while the app is in the background, the
            // web view will reset to progression 0 instead of the current one.
            // We need to wait for the application to return to the foreground
            // to maintain the current location.
            needsReloadSpreadsOnActive = true
            return
        }

        _reloadSpreads()
    }

    private func _reloadSpreads() {
        let locator = currentLocation

        guard
            let paginationView = paginationView,
            on(.load(locator))
        else {
            return
        }

        spreads = EPUBSpread.makeSpreads(
            for: publication,
            readingOrder: readingOrder,
            readingProgression: viewModel.readingProgression,
            spread: viewModel.spreadEnabled,
            offsetFirstPage: viewModel.offsetFirstPage
        )

        let initialIndex: ReadingOrder.Index = {
            if
                let href = locator?.href,
                let index = readingOrder.firstIndexWithHREF(href),
                let foundIndex = self.spreads.firstIndexWithReadingOrderIndex(index)
            {
                return foundIndex
            } else {
                return 0
            }
        }()

        paginationView.reloadAtIndex(
            initialIndex,
            location: PageLocation(locator),
            pageCount: spreads.count,
            readingProgression: viewModel.readingProgression
        )

        on(.loaded)
    }

    private func loadedSpreadViewForHREF<T: URLConvertible>(_ href: T) -> EPUBSpreadView? {
        guard
            let loadedViews = paginationView?.loadedViews,
            let index = readingOrder.firstIndexWithHREF(href)
        else {
            return nil
        }

        return loadedViews
            .compactMap { _, view in view as? EPUBSpreadView }
            .first { $0.spread.contains(index: index) }
    }

    // MARK: - Navigator

    private var isPaginationViewScrollingEnabled: Bool {
        !(config.disablePageTurnsWhileScrolling && settings.scroll)
    }

    public var presentation: VisualNavigatorPresentation {
        VisualNavigatorPresentation(
            readingProgression: settings.readingProgression,
            scroll: settings.scroll,
            axis: (settings.scroll && !settings.verticalText)
                ? .vertical
                : .horizontal
        )
    }

    private func computeCurrentLocationAndViewport() async -> (Locator?, NavigatorViewport?) {
        if case .initializing = state {
            assertionFailure("Cannot update current location when initializing the navigator")
            return (nil, nil)
        }

        // Returns any pending locator to prevent returning invalid locations
        // while loading it.
        if let pendingLocator = state.pendingLocator {
            return (pendingLocator, nil)
        }

        guard let spreadView = paginationView?.currentView as? EPUBSpreadView else {
            return (nil, nil)
        }

        let (locator, viewport) = await EPUBViewportAndLocationCalculator.compute(
            readingOrderIndices: spreadView.spread.readingOrderIndices,
            progression: { spreadView.progression(in: $0) },
            readingOrder: readingOrder,
            positionsByReadingOrder: positionsByReadingOrder,
            tableOfContentsTitleByHref: tableOfContentsTitleByHref,
            fallbackLocator: { [publication] in await publication.locate($0) }
        )
        return (locator, viewport)
    }

    public func firstVisibleElementLocator() async -> Locator? {
        guard let spreadView = paginationView?.currentView as? EPUBSpreadView else {
            return nil
        }
        return await spreadView.findFirstVisibleElementLocator()
    }

    /// Last current location notified to the delegate.
    /// Used to avoid sending twice the same location.
    private var notifiedCurrentLocation: Locator?

    /// Rally: computes and notifies the current location at once (skipped while not idle, as upstream's).
    private func notifyCurrentLocationNow() async {
        guard state == .idle else {
            return
        }
        (currentLocation, viewport) = await computeCurrentLocationAndViewport()
        if
            let delegate = delegate,
            let location = currentLocation,
            location != notifiedCurrentLocation
        {
            notifiedCurrentLocation = location
            delegate.navigator(self, locationDidChange: location)
        }
    }

    private lazy var updateCurrentLocation = execute(
        // If we're not in an `idle` state, we postpone the notification.
        when: { [weak self] in self?.state == .idle },
        pollingInterval: 0.1
    ) { [weak self] in
        guard let self = self else {
            return
        }

        (currentLocation, viewport) = await computeCurrentLocationAndViewport()

        if
            let delegate = delegate,
            let location = currentLocation,
            location != notifiedCurrentLocation
        {
            notifiedCurrentLocation = location
            delegate.navigator(self, locationDidChange: location)
        }
    }

    public func go(to locator: Locator, options: NavigatorGoOptions) async -> Bool {
        let locator = publication.normalizeLocator(locator)

        guard
            let paginationView = paginationView,
            let index = readingOrder.firstIndexWithHREF(locator.href),
            let spreadIndex = spreads.firstIndexWithReadingOrderIndex(index),
            on(.jump(locator))
        else {
            return false
        }

        let success = await paginationView.goToIndex(spreadIndex, location: .locator(locator), options: options)
        on(.jumped)
        if success {
            delegate?.navigator(self, didJumpTo: locator)
        }
        // Rally: report the new location as soon as the jump ends, as 2.x did. Upstream's notification waits for an
        // idle state, polled every 0.1 s, which lets the app's read-aloud see the old page after a chapter change.
        Task { await self.notifyCurrentLocationNow() }
        return success
    }

    public func go(to link: Link, options: NavigatorGoOptions) async -> Bool {
        guard let locator = await publication.locate(link) else {
            return false
        }
        return await go(to: locator, options: options)
    }

    @discardableResult
    public func goForward(options: NavigatorGoOptions) async -> Bool {
        let direction: EPUBSpreadView.Direction = {
            switch viewModel.readingProgression {
            case .ltr:
                return .right
            case .rtl:
                return .left
            }
        }()
        return await go(to: direction, options: options)
    }

    @discardableResult
    public func goBackward(options: NavigatorGoOptions) async -> Bool {
        let direction: EPUBSpreadView.Direction = {
            switch viewModel.readingProgression {
            case .ltr:
                return .left
            case .rtl:
                return .right
            }
        }()
        return await go(to: direction, options: options)
    }

    // MARK: - Rally queries

    /// Rally: words and characters read up to a locator in its resource.
    public struct LocatorReadingProgress: Equatable {
        public let readWords: Int
        public let totalWords: Int
        public let readCharacters: Int
        public let totalCharacters: Int
        public let wordsPercentage: Double
        public let charactersPercentage: Double

        public init(
            readWords: Int,
            totalWords: Int,
            readCharacters: Int,
            totalCharacters: Int,
            wordsPercentage: Double,
            charactersPercentage: Double
        ) {
            self.totalWords = max(0, totalWords)
            self.totalCharacters = max(0, totalCharacters)
            self.readWords = min(max(0, readWords), self.totalWords)
            self.readCharacters = min(max(0, readCharacters), self.totalCharacters)
            self.wordsPercentage = min(max(wordsPercentage, 0), 100)
            self.charactersPercentage = min(max(charactersPercentage, 0), 100)
        }

        init?(json: [String: Any]) {
            guard
                let readWords = Self.intValue(from: json["readWords"]),
                let totalWords = Self.intValue(from: json["totalWords"]),
                let readCharacters = Self.intValue(from: json["readCharacters"]),
                let totalCharacters = Self.intValue(from: json["totalCharacters"])
            else {
                return nil
            }

            let computedWordsPercentage = totalWords > 0 ? (Double(readWords) / Double(totalWords)) * 100.0 : 0
            let computedCharactersPercentage = totalCharacters > 0 ? (Double(readCharacters) / Double(totalCharacters)) * 100.0 : 0
            self.init(
                readWords: readWords,
                totalWords: totalWords,
                readCharacters: readCharacters,
                totalCharacters: totalCharacters,
                wordsPercentage: Self.doubleValue(from: json["wordsPercentage"]) ?? computedWordsPercentage,
                charactersPercentage: Self.doubleValue(from: json["charactersPercentage"]) ?? computedCharactersPercentage
            )
        }

        private static func intValue(from value: Any?) -> Int? {
            if let intValue = value as? Int {
                return intValue
            }
            if let doubleValue = value as? Double {
                return Int(doubleValue)
            }
            if let number = value as? NSNumber {
                return number.intValue
            }
            if let string = value as? String, let intValue = Int(string) {
                return intValue
            }
            return nil
        }

        private static func doubleValue(from value: Any?) -> Double? {
            if let doubleValue = value as? Double {
                return doubleValue
            }
            if let intValue = value as? Int {
                return Double(intValue)
            }
            if let number = value as? NSNumber {
                return number.doubleValue
            }
            if let string = value as? String, let doubleValue = Double(string) {
                return doubleValue
            }
            return nil
        }
    }

    /// Rally: evaluates `script` in `spreadView` once its load is over (`isSpreadReady`) — after the Rally decoration
    /// templates rewrote the page's text (`processSpansForTextSpacing`), as in 2.x, where the queries came after it —
    /// answering on the main actor. A spread that does not load within 10 s answers `spreadNotLoaded` (it was dropped
    /// meanwhile). Waiting for `isSpreadLoaded` alone was not enough: it is set before the templates are registered,
    /// and a chapter opened directly was read with its text not yet rewritten.
    private func evaluateRallyScript<H: URLConvertible>(_ script: String, in spreadView: EPUBSpreadView, href: H?, completion: @escaping (Result<Any, Error>) -> Void) {
        let href = href?.anyURL
        var answered = false
        func answer(_ result: Result<Any, Error>) {
            guard !answered else { return }
            answered = true
            completion(result)
        }
        Task {
            answer(await spreadView.evaluateScriptWhenReady(script, inHREF: href))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            answer(.failure(EPUBError.spreadNotLoaded))
        }
    }

    /// Rally: a text locator in `href` from a `{ text: … }` result of the fork's JavaScript.
    private func textLocator<H: URLConvertible>(in href: H, from result: Result<Any, Error>) -> Locator? {
        switch result {
        case let .success(value):
            guard
                let selection = value as? [String: Any],
                let text = try? Locator.Text(json: JSONValue(selection["text"]))
            else {
                return nil
            }
            return Locator(href: href, mediaType: .html, text: text)
        case let .failure(error):
            log(.error, error)
            return nil
        }
    }

    /// Rally: the rect of `locator` (`readium.clientRectFromLocator`), in the navigator's space when `convertRect`.
    /// As in 2.7, `completion` is not called when the resource is not loaded or the JavaScript returns no rect.
    public func getRectFromLocator(_ locator: Locator, convertRect: Bool = true, reset: Bool = false, cache: Bool = true, completion: @escaping (CGRect?) -> Void) {
        guard let locatorJSON = try? locator.jsonString() else {
            completion(nil)
            return
        }
        guard let spreadView = loadedSpreadViewForHREF(locator.href) else {
            return
        }
        let script = "readium.clientRectFromLocator(\(locatorJSON), \(reset ? 1 : 0), \(cache ? 1 : 0))"
        evaluateRallyScript(script, in: spreadView, href: locator.href) { [weak self, weak spreadView] result in
            switch result {
            case let .success(value):
                if let frame = CGRect(json: value) {
                    completion(convertRect ? spreadView?.convertRectToNavigatorSpace(frame) : frame)
                }
            case let .failure(error):
                self?.log(.error, error)
                completion(nil)
            }
        }
    }

    /// Rally: the text of each page of a reflowable resource, in page order (`readium.calculateHorizontalPageRanges`).
    public func getPageRanges<H: URLConvertible>(_ href: H, completion: @escaping ([String]) -> Void) {
        guard let spreadView = loadedSpreadViewForHREF(href) else {
            completion([])
            return
        }
        evaluateRallyScript("readium.calculateHorizontalPageRanges()", in: spreadView, href: href) { [weak self] result in
            var pages = [String]()
            switch result {
            case let .success(value):
                if let json = value as? [String: String] {
                    let keys = json.keys.sorted { Int($0) ?? 0 < Int($1) ?? 0 }
                    for key in keys {
                        if let page = json[key] {
                            pages.append(page)
                        }
                    }
                }
            case let .failure(error):
                self?.log(.error, error)
            }
            completion(pages)
        }
    }

    /// Rally: runs a script answering `{ text: … }` in the loaded resource `href`.
    private func textLocatorQuery<H: URLConvertible>(_ script: String, href: H, completion: @escaping (Locator?) -> Void) {
        guard let spreadView = loadedSpreadViewForHREF(href) else {
            completion(nil)
            return
        }
        evaluateRallyScript(script, in: spreadView, href: href) { [weak self] result in
            completion(self?.textLocator(in: href, from: result))
        }
    }

    /// Rally: the first word visible in `href`.
    public func getFirstWordLocatorFromVisiblePage<H: URLConvertible>(href: H, completion: @escaping (Locator?) -> Void) {
        textLocatorQuery("readium.getFirstVisibleWordText()", href: href, completion: completion)
    }

    /// Rally: the last word visible in `href`.
    public func getLastWordLocatorFromVisiblePage<H: URLConvertible>(href: H, completion: @escaping (Locator?) -> Void) {
        textLocatorQuery("readium.getLastVisibleWordText()", href: href, completion: completion)
    }

    /// Rally: the last word of the resource `href`.
    public func getLastWordLocatorFromHref<H: URLConvertible>(_ href: H, completion: @escaping (Locator?) -> Void) {
        textLocatorQuery("readium.getLastWordText()", href: href, completion: completion)
    }

    /// Rally: words and characters read up to `locator` in its resource.
    public func getReadingProgressForLocator(_ locator: Locator, completion: @escaping (LocatorReadingProgress?) -> Void) {
        guard
            let locatorJSON = try? locator.jsonString(),
            let spreadView = loadedSpreadViewForHREF(locator.href)
        else {
            completion(nil)
            return
        }
        evaluateRallyScript("readium.getReadingProgressForLocator(\(locatorJSON))", in: spreadView, href: locator.href) { [weak self] result in
            switch result {
            case let .success(value):
                completion((value as? [String: Any]).flatMap { LocatorReadingProgress(json: $0) })
            case let .failure(error):
                self?.log(.error, error)
                completion(nil)
            }
        }
    }

    /// Rally: runs a script answering a string in the loaded resource `href`.
    private func stringQuery<H: URLConvertible>(_ script: String, href: H, completion: @escaping (String?) -> Void) {
        guard let spreadView = loadedSpreadViewForHREF(href) else {
            completion(nil)
            return
        }
        evaluateRallyScript(script, in: spreadView, href: href) { [weak self] result in
            switch result {
            case let .success(value):
                completion(value as? String)
            case let .failure(error):
                self?.log(.error, error)
                completion(nil)
            }
        }
    }

    /// Rally: the text of the resource's body (`readium.getHtmlBodyTextContent`).
    public func getHtmlBodyTextContent<H: URLConvertible>(href: H, completion: @escaping (String?) -> Void) {
        stringQuery("readium.getHtmlBodyTextContent()", href: href, completion: completion)
    }

    /// Rally: the visible text of the resource.
    public func getVisibleText<H: URLConvertible>(href: H, completion: @escaping (String?) -> Void) {
        stringQuery("readium.getVisibleText()", href: href, completion: completion)
    }

    /// Rally: the range of the visible text in the resource's text.
    public func getVisibleTextRange<H: URLConvertible>(href: H, completion: @escaping (NSRange?) -> Void) {
        guard let spreadView = loadedSpreadViewForHREF(href) else {
            completion(nil)
            return
        }
        evaluateRallyScript("readium.getVisibleTextRange()", in: spreadView, href: href) { [weak self] result in
            switch result {
            case let .success(value):
                if
                    let dict = value as? [String: Int],
                    let location = dict["location"],
                    let length = dict["length"]
                {
                    completion(NSRange(location: location, length: length))
                } else {
                    completion(nil)
                }
            case let .failure(error):
                self?.log(.error, error)
                completion(nil)
            }
        }
    }

    /// Rally: whether the loaded resource `href` is shown in a fixed-layout spread; nil when it is not loaded.
    public func spreadHasFixedLayout<H: URLConvertible>(href: H) -> Bool? {
        loadedSpreadViewForHREF(href).map { $0 is EPUBFixedSpreadView }
    }

    /// Rally: whether the current spread's scroll view shows its last page.
    public func currentSpreadDisplayingLastPage() -> Bool {
        guard let spreadView = paginationView?.currentView as? EPUBSpreadView else {
            return false
        }
        let offset = spreadView.scrollView.contentOffset.x
        let contentWidth = spreadView.scrollView.contentSize.width
        let pageWidth = spreadView.scrollView.bounds.width
        return offset + pageWidth >= contentWidth
    }

    /// Rally: whether the current spread shows two fixed-layout pages side by side and one of them is `href`, so there
    /// is no need to navigate to it.
    public func currentTwoPageFixedSpreadContains<H: URLConvertible>(href: H) -> Bool {
        guard
            let spreadView = paginationView?.currentView as? EPUBSpreadView,
            spreadView is EPUBFixedSpreadView,
            viewModel.spreadEnabled
        else {
            return false
        }
        return spreadView.spread.linkWithHREF(href) != nil
    }

    // MARK: - Rally start page side selection

    public enum ReaderStartPage {
        case visible
        case left
        case right
    }

    public struct StartPageLayout {
        public let isTwoUp: Bool
        public let isFixedLayout: Bool
        public let leftHref: AnyURL?
        public let rightHref: AnyURL?

        public init(isTwoUp: Bool, isFixedLayout: Bool, leftHref: AnyURL?, rightHref: AnyURL?) {
            self.isTwoUp = isTwoUp
            self.isFixedLayout = isFixedLayout
            self.leftHref = leftHref
            self.rightHref = rightHref
        }
    }

    /// Rally: whether the current spread shows two pages, and the resources on its left and right.
    public func currentStartPageLayout(completion: @escaping (StartPageLayout) -> Void) {
        guard let spreadView = paginationView?.currentView as? EPUBSpreadView else {
            completion(StartPageLayout(isTwoUp: false, isFixedLayout: false, leftHref: nil, rightHref: nil))
            return
        }

        if spreadView is EPUBFixedSpreadView {
            switch spreadView.spread {
            case let .double(spread):
                completion(StartPageLayout(
                    isTwoUp: true,
                    isFixedLayout: true,
                    leftHref: spread.left(for: viewModel.readingProgression).link.url(),
                    rightHref: spread.right(for: viewModel.readingProgression).link.url()
                ))
            case let .single(spread):
                completion(StartPageLayout(isTwoUp: false, isFixedLayout: true, leftHref: spread.resource.link.url(), rightHref: nil))
            }
        } else {
            let href = spreadView.spread.first.link.url()
            evaluateRallyScript("readium.getColumnCountPerScreen()", in: spreadView, href: href) { result in
                var isTwoUp = false
                if let value = try? result.get() as? Int, value >= 2 {
                    isTwoUp = true
                } else if let value = try? result.get() as? String, Int(value) ?? 0 >= 2 {
                    isTwoUp = true
                }
                completion(StartPageLayout(isTwoUp: isTwoUp, isFixedLayout: false, leftHref: href, rightHref: isTwoUp ? href : nil))
            }
        }
    }

    /// Rally: the first visible word of `href`, on the given side of a two-column page.
    public func getFirstWordLocatorFromVisiblePage<H: URLConvertible>(href: H, side: ReaderStartPage, completion: @escaping (Locator?) -> Void) {
        switch side {
        case .visible:
            getFirstWordLocatorFromVisiblePage(href: href, completion: completion)
        case .left, .right:
            let sideArg = side == .left ? "left" : "right"
            textLocatorQuery("readium.getFirstVisibleWordTextOnSide('\(sideArg)')", href: href, completion: completion)
        }
    }

    /// Rally: the first word of the given page of the current spread.
    public func getFirstWordLocatorForStartPage(side: ReaderStartPage, completion: @escaping (Locator?) -> Void) {
        currentStartPageLayout { [weak self] layout in
            guard let self = self else {
                completion(nil)
                return
            }
            switch side {
            case .visible:
                if let href = layout.leftHref {
                    self.getFirstWordLocatorFromVisiblePage(href: href, completion: completion)
                } else {
                    completion(nil)
                }
            case .left:
                if let href = layout.leftHref {
                    if layout.isFixedLayout {
                        self.getFirstWordLocatorFromVisiblePage(href: href, completion: completion)
                    } else {
                        self.getFirstWordLocatorFromVisiblePage(href: href, side: .left, completion: completion)
                    }
                } else {
                    completion(nil)
                }
            case .right:
                if let href = layout.rightHref {
                    if layout.isFixedLayout {
                        self.getFirstWordLocatorFromVisiblePage(href: href, completion: completion)
                    } else {
                        self.getFirstWordLocatorFromVisiblePage(href: href, side: .right, completion: completion)
                    }
                } else {
                    completion(nil)
                }
            }
        }
    }

    /// Rally: the scroll view of the loaded spread showing `href`.
    public func scrollViewInsideSpreadView<H: URLConvertible>(forHREF href: H) -> UIScrollView? {
        loadedSpreadViewForHREF(href)?.scrollView
    }

    /// Rally: the scroll views of every loaded spread.
    public func allLoadedScrollViews() -> [UIScrollView] {
        (paginationView?.loadedViews ?? [:]).compactMap { _, view in
            (view as? EPUBSpreadView)?.scrollView
        }
    }

    // MARK: - SelectableNavigator

    public var currentSelection: Selection? {
        viewModel.editingActions.selection
    }

    public func clearSelection() {
        guard let paginationView = paginationView else {
            return
        }

        for (_, pageView) in paginationView.loadedViews {
            (pageView as? EPUBSpreadView)?.webView.clearSelection()
        }
    }

    // MARK: - DecorableNavigator

    private var decorations: [DecorationGroup: [DiffableDecoration]] = [:]

    /// Decoration group callbacks, indexed by the group name.
    private var decorationCallbacks: [DecorationGroup: [DecorableNavigator.OnActivatedCallback]] = [:]


    public func supports(decorationStyle style: Decoration.Style.Id) -> Bool {
        config.decorationTemplates.keys.contains(style)
    }

    public func apply(decorations: [Decoration], in group: DecorationGroup) {
        apply(decorations: decorations, enhanced: false, in: group)
    }

    /// Rally: the stored decorations change when this is called, in call order with `addDecorations` and `remove`
    /// (upstream changes them later, in a task, which would undo an `addDecorations` made right after); the scripts go
    /// to the loaded spread views at once, and a spread loading later re-adds the stored state (as in 2.x).
    public func apply(decorations: [Decoration], enhanced: Bool, in group: DecorationGroup) {
        let source = self.decorations[group] ?? []
        let target = decorations.map {
            var d = $0
            d.locator = publication.normalizeLocator(d.locator)
            return DiffableDecoration(decoration: d)
        }
        self.decorations[group] = target

        guard let paginationView = paginationView else {
            return
        }

        if decorations.isEmpty {
            // The updates command are using `requestAnimationFrame()`, so we need it for `clear()` as well otherwise
            // we might recreate a highlight after it has been cleared.
            let script = enhanced
                ? "requestAnimationFrame(function () { readium.getDecorations('\(group)').clearAllEnhanced(); });"
                : "requestAnimationFrame(function () { readium.getDecorations('\(group)').clear(); });"
            for (_, pageView) in paginationView.loadedViews {
                evaluateDecorationScript(script, in: pageView as? EPUBSpreadView)
            }
        } else {
            for (href, changes) in target.changesByHREF(from: source, enhanced: enhanced) {
                guard let script = changes.javascript(forGroup: group, styles: config.decorationTemplates) else {
                    continue
                }
                evaluateDecorationScript(script, in: loadedSpreadViewForHREF(href), href: href)
            }
        }
    }

    public func addDecorations(decorations: [Decoration], enhanced: Bool, in group: DecorationGroup, completion: @escaping () -> Void) {
        let target = decorations.map {
            var d = $0
            d.locator = publication.normalizeLocator(d.locator)
            return DiffableDecoration(decoration: d)
        }
        // As in 2.7: stored only when the group already has decorations.
        self.decorations[group]?.append(contentsOf: target)

        for (href, changes) in target.changesByHREF(from: [], enhanced: enhanced) {
            guard let script = changes.javascript(forGroup: group, styles: config.decorationTemplates) else {
                continue
            }
            evaluateDecorationScript(script, in: loadedSpreadViewForHREF(href), href: href)
        }

        completion()
    }

    public func remove(decoration: Decoration, in group: DecorationGroup) {
        var groupDecorations = self.decorations[group]
        groupDecorations?.removeAll { $0.decoration.id == decoration.id }
        self.decorations[group] = groupDecorations

        let script = "requestAnimationFrame(function () { readium.getDecorations('\(group)').clearEnhanced('\(decoration.id)'); });"
        evaluateDecorationScript(script, in: loadedSpreadViewForHREF(publication.normalizeLocator(decoration.locator).href))
    }

    public func observeDecorationRectCalculations(inGroup group: DecorationGroup, onActivated: OnRectCalculatedCallback?) {
        guard let onActivated = onActivated else {
            return
        }
        var callbacks = decorationRectsCallbacks[group] ?? []
        callbacks.append(onActivated)
        decorationRectsCallbacks[group] = callbacks

        for (_, view) in paginationView?.loadedViews ?? [:] {
            evaluateDecorationScript("readium.getDecorations('\(group)').setActivable();", in: view as? EPUBSpreadView)
        }
    }

    /// Rally: decoration rect callbacks, indexed by the group name.
    private var decorationRectsCallbacks: [DecorationGroup: [DecorableNavigator.OnRectCalculatedCallback]] = [:]

    /// Rally: sends a decoration script to `spreadView` at once, as the 2.x navigator did (Readium 3 would wait until
    /// the spread is marked loaded, after its scripts are ready, and the read-aloud waits for the marks' rects). A page
    /// not ready yet drops it and re-adds the stored decorations when it loads.
    private func evaluateDecorationScript(_ script: String, in spreadView: EPUBSpreadView?, href: AnyURL? = nil) {
        guard let spreadView = spreadView else {
            return
        }
        Task {
            await spreadView.evaluateScriptNow(script, inHREF: href)
        }
    }

    public func observeDecorationInteractions(inGroup group: DecorationGroup, onActivated: @escaping OnActivatedCallback) {
        var callbacks = decorationCallbacks[group] ?? []
        callbacks.append(onActivated)
        decorationCallbacks[group] = callbacks

        Task {
            await initialized()

            guard let paginationView = paginationView else {
                return
            }

            await withTaskGroup(of: Void.self) { tasks in
                for (_, view) in paginationView.loadedViews {
                    tasks.addTask {
                        await (view as? EPUBSpreadView)?.evaluateScript("readium.getDecorations('\(group)').setActivable();")
                    }
                }
            }
        }
    }

    // MARK: - Configurable

    public var settings: EPUBSettings {
        viewModel.settings
    }

    public func submitPreferences(_ preferences: EPUBPreferences) {
        viewModel.submitPreferences(preferences)
        applySettings()

        delegate?.navigator(self, presentationDidChange: presentation)
    }

    public func editor(of preferences: EPUBPreferences) -> EPUBPreferencesEditor {
        viewModel.editor(of: preferences)
    }

    /// Applies user settings that require native configuration instead of
    /// CSS properties.
    private func applySettings() {
        guard isViewLoaded else {
            return
        }

        view.backgroundColor = settings.effectiveBackgroundColor.uiColor
        paginationView?.isScrollEnabled = isPaginationViewScrollingEnabled
    }

    // MARK: - EPUB-specific extensions

    /// Evaluates the given JavaScript on the currently visible HTML resource.
    @discardableResult
    public func evaluateJavaScript(_ script: String) async -> Result<Any, Error> {
        guard let spreadView = paginationView?.currentView as? EPUBSpreadView else {
            return .failure(EPUBError.spreadNotLoaded)
        }
        return await spreadView.evaluateScript(script)
    }

    // MARK: - UIAccessibilityAction

    override open func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
        guard !super.accessibilityScroll(direction) else {
            return true
        }

        let options = NavigatorGoOptions(animated: false)

        Task {
            switch direction {
            case .right:
                await goLeft(options: options)
            case .left:
                await goRight(options: options)
            case .next, .down:
                await goForward(options: options)
            case .previous, .up:
                await goBackward(options: options)
            @unknown default:
                break
            }
        }
        return true
    }
}

extension EPUBNavigatorViewController: EPUBNavigatorViewModelDelegate {
    func epubNavigatorViewModelInvalidatePaginationView(_ viewModel: EPUBNavigatorViewModel) {
        invalidatePaginationView()
    }

    func epubNavigatorViewModel(_ viewModel: EPUBNavigatorViewModel, runScript script: String, in scope: EPUBScriptScope) {
        Task {
            await initialized()

            guard let paginationView = paginationView else {
                return
            }

            switch scope {
            case .currentResource:
                await (paginationView.currentView as? EPUBSpreadView)?.evaluateScript(script)

            case .loadedResources:
                await withTaskGroup(of: Void.self) { tasks in
                    for (_, view) in paginationView.loadedViews {
                        tasks.addTask {
                            await (view as? EPUBSpreadView)?.evaluateScript(script)
                        }
                    }
                }

            case let .resource(href):
                for (_, view) in paginationView.loadedViews {
                    guard
                        let view = view as? EPUBSpreadView,
                        let index = readingOrder.firstIndexWithHREF(href),
                        view.spread.contains(index: index)
                    else {
                        continue
                    }
                    await view.evaluateScript(script, inHREF: href)
                    return
                }
            }
        }
    }

    func epubNavigatorViewModel(
        _ viewModel: EPUBNavigatorViewModel,
        didFailToLoadResourceAt href: RelativeURL,
        withError error: ReadError
    ) {
        DispatchQueue.main.async {
            self.delegate?.navigator(self, didFailToLoadResourceAt: href, withError: error)
        }
    }
}

extension EPUBNavigatorViewController: EPUBSpreadViewDelegate {
    func spreadViewContentInset(_ spreadView: EPUBSpreadView) -> UIEdgeInsets {
        if let inset = delegate?.navigatorContentInset(self) {
            return inset
        }

        // We use the window's safeAreaInsets instead of the view's because we
        // only want to take into account the device notch and status bar, not
        // the application's bars.
        var insets = view.window?.safeAreaInsets ?? .zero

        switch publication.metadata.epubLayout {
        case .fixed:
            // With iPadOS and macOS, we aim to display content edge-to-edge
            // since there are no physical notches or Dynamic Island like on the
            // iPhone.
            if UIDevice.current.userInterfaceIdiom != .phone {
                insets = .zero
            }

        case .reflowable:
            let configInset = config.contentInset(for: view.traitCollection.verticalSizeClass)
            insets.top = max(insets.top, configInset.top)
            insets.bottom = max(insets.bottom, configInset.bottom)
        }

        return insets
    }

    func spreadViewDidLoad(_ spreadView: EPUBSpreadView) async {
        let templates = config.decorationTemplates.reduce(into: [String: JSONValue]()) { styles, item in
            styles[item.key.rawValue] = .object(item.value.jsonObject)
        }

        guard let stylesJSON = try? templates.jsonString() else {
            log(.error, "Can't serialize decoration styles to JSON")
            return
        }
        var script = "readium.registerDecorationTemplates(\(stylesJSON.replacingOccurrences(of: "\\n", with: " ")));\n"

        script += decorationCallbacks
            .compactMap { group, callbacks in
                guard !callbacks.isEmpty else {
                    return nil
                }
                return "readium.getDecorations('\(group)').setActivable();"
            }
            .joined(separator: "\n")

        let links = spreadView.spread.readingOrderIndices
            .compactMap { readingOrder.getOrNil($0) }

        for link in links {
            let href = link.url()
            for (group, decorations) in decorations {
                let decorations = decorations
                    .filter { $0.decoration.locator.href.isEquivalentTo(href) }
                    .map {
                        // Rally: decorations made with the enhanced layout are re-added with it.
                        ($0.decoration.userInfo["enhancedLayout"] as? Bool) == true
                            ? DecorationChange.addEnhanced($0.decoration)
                            : DecorationChange.add($0.decoration)
                    }

                guard let decorationsScript = decorations.javascript(forGroup: group, styles: config.decorationTemplates) else {
                    continue
                }
                script += decorationsScript
            }
        }

        await spreadView.evaluateScript("(function() {\n\(script)\n})();")

        for link in links {
            delegate?.spreadViewDidLoad(href: link.url())
        }
    }

    func spreadView(_ spreadView: EPUBSpreadView, didReceive event: PointerEvent) {
        Task {
            var event = event
            event.location = view.convert(event.location, from: spreadView)
            if let targetElement = event.targetElement {
                event.targetElement?.frame = view.convert(targetElement.frame, from: spreadView)
            }
            _ = await inputObservers.didReceive(event)
        }
    }

    func spreadView(_ spreadView: EPUBSpreadView, didReceive event: KeyEvent) {
        Task {
            _ = await inputObservers.didReceive(event)
        }
    }

    func spreadView(_ spreadView: EPUBSpreadView, didTapOnExternalURL url: URL) {
        guard state == .idle else { return }

        delegate?.navigator(self, presentExternalURL: url)
    }

    func spreadView(_ spreadView: EPUBSpreadView, didTapOnInternalLink href: String, clickEvent: ClickEvent?) {
        guard
            let url = AnyURL(string: href),
            var link = publication.linkWithHREF(url)
        else {
            log(.warning, "Cannot find link with HREF: \(href)")
            return
        }
        link.href = href

        Task {
            // Check to see if this was a noteref link and give delegate the
            // opportunity to display it.
            if
                let clickEvent = clickEvent,
                let interactive = clickEvent.interactiveElement,
                let (note, referrer) = await getNoteData(anchor: interactive, href: href),
                let delegate = delegate
            {
                if !delegate.navigator(
                    self,
                    shouldNavigateToNoteAt: link,
                    content: note,
                    referrer: referrer
                ) {
                    return
                }
            }

            // Ask if we should navigate to the link
            if let delegate = delegate, !delegate.navigator(self, shouldNavigateToLink: link) {
                return
            }

            await go(to: link)
        }
    }

    /// Checks if the internal link is a noteref, and retrieves both the referring text of the link and the body of the note.
    ///
    /// Uses the navigation href from didTapOnInternalLink because it is normalized to a path within the book,
    /// whereas the anchor tag may have just a hash fragment like `#abc123` which is hard to work with.
    /// We do at least validate to ensure that the two hrefs match.
    ///
    /// Uses `#id` when retrieving the body of the note, not `aside#id` because it may be a `<section>`.
    /// See https://idpf.github.io/epub-vocabs/structure/#footnotes
    /// and http://kb.daisy.org/publishing/docs/html/epub-type.html#ex
    func getNoteData(anchor: String, href: String) async -> (String, String)? {
        do {
            let doc = try parse(anchor)
            guard let link = try doc.select("a[epub:type=noteref]").first() else { return nil }

            let anchorHref = try link.attr("href")
            guard href.hasSuffix(anchorHref) else { return nil }

            guard
                let url = AnyURL(string: href),
                let id = url.fragment
            else {
                log(.warning, "Could not find hash in link \(href)")
                return nil
            }

            // Read the note's resource through the publication's resource API.
            guard let resource = publication.get(url.removingFragment()) else {
                log(.warning, "Could not open note resource: \(href)")
                return nil
            }
            let contents = try await resource.read().asString().get()
            let document = try parse(contents)

            guard let aside = try document.select("#\(id)").first() else {
                log(.warning, "Could not find the element '#\(id)' in document \(href)")
                return nil
            }

            return try (aside.html(), link.html())

        } catch {
            log(.warning, "Caught error while getting note content: \(error)")
            return nil
        }
    }

    func spreadView(_ spreadView: EPUBSpreadView, didActivateDecoration id: Decoration.Id, inGroup group: DecorationGroup, frame: CGRect?, point: CGPoint?) {
        guard
            let callbacks = decorationCallbacks[group].takeIf({ !$0.isEmpty }),
            let decoration: Decoration = decorations[group]?
            .first(where: { $0.decoration.id == id })
            .map(\.decoration)
        else {
            return
        }

        for callback in callbacks {
            callback(OnDecorationActivatedEvent(decoration: decoration, group: group, rect: frame, point: point))
        }
    }

    func spreadView(_ spreadView: EPUBSpreadView, selectionDidChange text: Locator.Text?, frame: CGRect) {
        guard
            let locator = currentLocation,
            let text = text
        else {
            viewModel.editingActions.selection = nil
            return
        }
        viewModel.editingActions.selection = Selection(
            locator: locator.copy(text: { $0 = text }),
            frame: frame
        )
    }

    func spreadViewPagesDidChange(_ spreadView: EPUBSpreadView) {
        if paginationView?.currentView == spreadView {
            updateCurrentLocation()
        }
    }

    func spreadView(_ spreadView: EPUBSpreadView, present viewController: UIViewController) {
        present(viewController, animated: true)
    }

    func spreadViewDidTerminate() {
        reloadSpreads()
    }

    func spreadView(_ spreadView: EPUBSpreadView, didCalculateDecorationRect id: Decoration.Id, inGroup group: DecorationGroup, frame: CGRect?, ocrLayout: Bool) {
        guard let callbacks = decorationRectsCallbacks[group].takeIf({ !$0.isEmpty }) else {
            return
        }
        for callback in callbacks {
            callback(OnDecorationRectEvent(decorationId: id, group: group, rect: frame, ocrLayout: ocrLayout))
        }
    }

    func spreadViewScrollViewWillBeginDragging(_ spreadView: EPUBSpreadView) {
        delegate?.navigatorScrollViewWillBeginDragging(self)
    }

    func spreadViewScrollViewDidEndDecelerating(_ spreadView: EPUBSpreadView) {
        delegate?.navigatorScrollViewDidEndDecelerating(self)
    }
}

extension EPUBNavigatorViewController: EditingActionsControllerDelegate {
    func editingActionsDidPreventCopy(_ editingActions: EditingActionsController) {
        delegate?.navigator(self, presentError: .copyForbidden)
    }

    func editingActions(_ editingActions: EditingActionsController, shouldShowMenuForSelection selection: Selection) -> Bool {
        delegate?.navigator(self, shouldShowMenuForSelection: selection) ?? true
    }

    func editingActions(_ editingActions: EditingActionsController, canPerformAction action: EditingAction, for selection: Selection) -> Bool {
        delegate?.navigator(self, canPerformAction: action, for: selection) ?? true
    }
}

extension EPUBNavigatorViewController: PaginationViewDelegate {
    func paginationView(_ paginationView: PaginationView, pageViewAtIndex index: Int) -> (UIView & PageView)? {
        let spread = spreads[index]
        let spreadViewType = (publication.metadata.layout == .fixed) ? EPUBFixedSpreadView.self : EPUBReflowableSpreadView.self
        let spreadView = spreadViewType.init(
            viewModel: viewModel,
            spread: spread,
            scripts: [],
            animatedLoad: false
        )
        spreadView.delegate = self

        let userContentController = spreadView.webView.configuration.userContentController
        delegate?.navigator(self, setupUserScripts: userContentController)

        return spreadView
    }

    func paginationViewDidUpdateViews(_ paginationView: PaginationView) {
        // Note that you should set the delegate before you load views
        // otherwise, when open the publication, you may miss the first
        // invocation.
        updateCurrentLocation()
    }

    func paginationViewScrollViewWillBeginDragging(_ paginationView: PaginationView) {
        delegate?.navigatorScrollViewWillBeginDragging(self)
    }

    func paginationViewScrollViewDidEndDecelerating(_ paginationView: PaginationView) {
        delegate?.navigatorScrollViewDidEndDecelerating(self)
    }

    func paginationView(_ paginationView: PaginationView, positionCountAtIndex index: Int) -> Int {
        spreads[index].positionCount(in: readingOrder, positionsByReadingOrder: positionsByReadingOrder)
    }
}
