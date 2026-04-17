//
//  Copyright 2024 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import Foundation
import WebKit

/// A custom web view which:
///  - Forwards copy: menu action to an EditingActionsController.
final class WebView: WKWebView {
    private let editingActions: EditingActionsController

    init(editingActions: EditingActionsController) {
        self.editingActions = editingActions

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = .all

        if #available(iOS 18.0, *) {
            config.writingToolsBehavior = .none
        }

        super.init(frame: .zero, configuration: config)

        #if DEBUG && swift(>=5.8)
            if #available(macOS 13.3, iOS 16.4, *) {
                isInspectable = true
            }
        #endif
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @available(iOS 13.0, *)
    override func buildMenu(with builder: any UIMenuBuilder) {
        editingActions.buildMenu(with: builder)

        // Don't call super as it is the only way to remove the
        // "Copy Link with Highlight" menu item.
        // See https://github.com/readium/swift-toolkit/issues/509
    }

    func clearSelection() {
        evaluateJavaScript("window.getSelection().removeAllRanges()")
        // Before iOS 12, we also need to disable user interaction to get rid of the selection overlays.
        isUserInteractionEnabled = false
        isUserInteractionEnabled = true
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        // Only allow actions explicitly configured in EditingActionsController.
        // Check our custom actions first; if not recognized, block it regardless
        // of what WKWebView would normally allow.
        guard editingActions.canPerformAction(action) else {
            return false
        }
        return super.canPerformAction(action, withSender: sender)
    }

    /// On Mac Catalyst, AppKit validates menu items via this method.
    /// Block any command whose action is not a recognized custom editing action.
    @available(iOS 13.0, *)
    override func validate(_ command: UICommand) {
        if !editingActions.canPerformAction(command.action) {
            command.attributes = .disabled
        }
        super.validate(command)
    }

    override func copy(_ sender: Any?) {
        editingActions.copy()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setupDragAndDrop()
    }

    private func setupDragAndDrop() {
        if !editingActions.canCopy {
            guard
                let webScrollView = subviews.first(where: { $0 is UIScrollView }),
                let contentView = webScrollView.subviews.first(where: { $0.interactions.count > 1 }),
                let dragInteraction = contentView.interactions.first(where: { $0 is UIDragInteraction })
            else {
                return
            }
            contentView.removeInteraction(dragInteraction)
        }
    }
}
