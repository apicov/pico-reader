package xyz.apicov.reader;

import android.content.Context;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Selecting text in the book opens the app's own panel (translate, highlight, copy, …), so while a book is open
     * (the #/read/… page) Android's floating menu over the selection (Copy, Share, Select all) is left empty: with no
     * items it doesn't show. The selection and its handles stay. Elsewhere in the app the menu is Android's own. The
     * WebView sits in a holder that hands its own menu callback to Android: the activity's onWindowStartingActionMode
     * can't, Android builds a floating menu from the original callback when it returns nothing. The WebView fills the menu when preparing it, not when creating it, so both are emptied.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView web = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) web.getParent();
        int index = parent.indexOfChild(web);
        ViewGroup.LayoutParams params = web.getLayoutParams();
        parent.removeView(web);
        FrameLayout holder = new NoSelectionMenu(this, web);
        holder.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        parent.addView(holder, index, params);
    }

    private static final class NoSelectionMenu extends FrameLayout {
        private final WebView web;

        NoSelectionMenu(Context context, WebView web) {
            super(context);
            this.web = web;
        }

        @Override
        public ActionMode startActionModeForChild(View originalView, ActionMode.Callback callback, int type) {
            String url = web.getUrl();
            boolean reading = url != null && url.contains("#/read/");
            return super.startActionModeForChild(originalView,
                    type == ActionMode.TYPE_FLOATING && reading ? new EmptyMenu(callback) : callback, type);
        }
    }

    private static final class EmptyMenu extends ActionMode.Callback2 {
        private final ActionMode.Callback inner;

        EmptyMenu(ActionMode.Callback inner) {
            this.inner = inner;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            boolean show = inner.onCreateActionMode(mode, menu);
            menu.clear();
            return show;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            boolean changed = inner.onPrepareActionMode(mode, menu);
            menu.clear();
            return changed;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            return inner.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            inner.onDestroyActionMode(mode);
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (inner instanceof ActionMode.Callback2) {
                ((ActionMode.Callback2) inner).onGetContentRect(mode, view, outRect);
            } else {
                super.onGetContentRect(mode, view, outRect);
            }
        }
    }
}
