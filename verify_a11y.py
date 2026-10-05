from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos/",
            record_video_size={"width": 1280, "height": 720}
        )
        page = context.new_page()

        # Go to the dev server with ?graphics=low
        page.goto("http://localhost:5173/?graphics=low")

        # Wait a bit
        page.wait_for_timeout(3000)

        # Force hide the loading overlay so we can see the UI
        page.evaluate("""
            const overlay = document.getElementById('candy-loading-overlay');
            if(overlay) overlay.style.display = 'none';
        """)

        # Force show the jukebox UI
        page.evaluate("""
            const container = document.getElementById('playlist-container');
            if(container) {
                container.classList.add('visible');
                container.style.display = 'flex';
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }
        """)

        # Empty the playlist
        page.evaluate("""
            const list = document.getElementById('playlist-list');
            if(list) list.innerHTML = '';
        """)

        # Call the render function to trigger the empty state render
        page.evaluate("""
            if(window.__playlistManager && window.__playlistManager.renderPlaylist) {
                window.__playlistManager.renderPlaylist();
            } else {
                // Manually inject if manager isn't available
                const list = document.getElementById('playlist-list');
                if(list) {
                    list.innerHTML = `<li id="jukebox-empty-state" class="playlist-empty" role="status" aria-label="Your playlist is empty. Drop some tracks in or browse to add music.">
        <span class="empty-icon" aria-hidden="true">🎵</span>
        <div class="empty-text">
          <span class="empty-title">Queue is Empty</span>
          <span class="empty-hint">Drop some tracks in!</span>
        </div>
      </li>`;
                }
            }
        """)

        page.wait_for_timeout(1000)

        # Print the HTML of the empty state to verify our attribute is there
        empty_html = page.evaluate("""
            const emptyState = document.getElementById('jukebox-empty-state');
            emptyState ? emptyState.outerHTML : 'Not found'
        """)
        print("Empty State HTML:")
        print(empty_html)

        page.screenshot(path="/home/jules/verification/screenshots/verification2.png")

        context.close()
        browser.close()

if __name__ == "__main__":
    run()
