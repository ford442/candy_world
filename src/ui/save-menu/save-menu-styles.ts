/**
 * Save Menu Styles
 * 
 * CSS styles for the save menu UI component.
 */

export const MENU_STYLES = `
.candy-save-menu {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(10, 10, 20, 0.85);
    backdrop-filter: blur(10px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    font-family: 'Segoe UI', system-ui, sans-serif;
    animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.candy-save-menu__container {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border-radius: 20px;
    padding: 30px;
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
    animation: slideUp 0.3s ease;
}

@keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

.candy-save-menu__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 25px;
    padding-bottom: 15px;
    border-bottom: 2px solid rgba(255, 105, 180, 0.5);
}

.candy-save-menu__title {
    color: #fff;
    font-size: 28px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(90deg, #ff69b4, #ffd700);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.candy-save-menu__close {
    background: none;
    border: none;
    color: #fff;
    font-size: 28px;
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.candy-save-menu__close:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: rotate(90deg);
}

.candy-save-menu__close:active {
    transform: rotate(90deg) scale(0.95);
    transition-duration: 0.05s;
}

.candy-save-menu__close:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

.candy-save-menu__tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.candy-save-menu__tab {
    padding: 10px 20px;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s;
    background: rgba(255, 255, 255, 0.1);
    color: #aaa;
}

.candy-save-menu__tab:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
}

.candy-save-menu__tab:active {
    transform: scale(0.95);
    transition-duration: 0.05s;
}

.candy-save-menu__tab:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

.candy-save-menu__tab--active {
    background: linear-gradient(90deg, #ff69b4, #ff1493);
    color: #fff;
}

.candy-save-menu__content {
    min-height: 300px;
}

.candy-save-menu__section {
    display: none;
}

.candy-save-menu__section--active {
    display: block;
    animation: fadeIn 0.3s ease;
}

/* Save Slots Grid */
.candy-save-slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 15px;
}

.candy-save-slot {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 15px;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid transparent;
    position: relative;
}

.candy-save-slot:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
}

.candy-save-slot:active {
    transform: translateY(0) scale(0.98);
    transition-duration: 0.05s;
}

.candy-save-slot--empty {
    border-style: dashed;
    border-color: rgba(255, 255, 255, 0.2);
}

.candy-save-slot--selected {
    border-color: #ff69b4;
    background: rgba(255, 105, 180, 0.1);
}

.candy-save-slot__icon {
    font-size: 32px;
    margin-bottom: 10px;
}

.candy-save-slot__name {
    color: #fff;
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 5px;
}

.candy-save-slot__info {
    color: #888;
    font-size: 12px;
    margin: 2px 0;
}

.candy-save-slot__badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #ff69b4;
    color: #fff;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
}

.candy-save-slot__actions {
    display: flex;
    gap: 5px;
    margin-top: 10px;
    opacity: 0;
    transition: opacity 0.2s;
}

.candy-save-slot:hover .candy-save-slot__actions {
    opacity: 1;
}

.candy-save-slot__btn {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
}

.candy-save-slot__btn--primary {
    background: #ff69b4;
    color: #fff;
}

.candy-save-slot__btn--secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.candy-save-slot__btn--danger {
    background: rgba(220, 38, 38, 0.8);
    color: #fff;
}

.candy-save-slot__btn:hover {
    transform: scale(1.05);
}

.candy-save-slot__btn:active {
    transform: scale(0.95);
    transition-duration: 0.05s;
}

.candy-save-slot__btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

.candy-save-slot__btn[aria-busy="true"],
.candy-save-menu__btn[aria-busy="true"] {
    cursor: wait !important;
    position: relative;
    pointer-events: none;
    opacity: 0.8;
}

.candy-save-slot__btn[aria-busy="true"] .spinner,
.candy-save-menu__btn[aria-busy="true"] .spinner {
    display: inline-block;
    width: 1em;
    height: 1em;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: #fff;
    animation: spin 1s ease-in-out infinite;
    margin-right: 5px;
    vertical-align: middle;
}

/* Action Buttons */
.candy-save-menu__actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    flex-wrap: wrap;
    justify-content: center;
}

.candy-save-menu__btn {
    padding: 12px 24px;
    border: none;
    border-radius: 25px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
}

.candy-save-menu__btn--primary {
    background: linear-gradient(90deg, #ff69b4, #ff1493);
    color: #fff;
}

.candy-save-menu__btn--secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.candy-save-menu__btn--danger {
    background: linear-gradient(90deg, #dc2626, #991b1b);
    color: #fff;
}

.candy-save-menu__btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}

.candy-save-menu__btn:active {
    transform: translateY(0) scale(0.95);
    transition-duration: 0.05s;
}

.candy-save-menu__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

.candy-save-menu__btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

/* Settings Panel */
.candy-settings-group {
    margin-bottom: 25px;
}

.candy-settings-group__title {
    color: #ff69b4;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.candy-settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.candy-settings-row__label {
    color: #ccc;
    font-size: 14px;
}

.candy-settings-row__control {
    display: flex;
    align-items: center;
    gap: 10px;
}

.candy-settings-row__value {
    color: #fff;
    font-size: 14px;
    min-width: 50px;
    text-align: right;
}

/* Custom Controls */
.candy-slider {
    width: 150px;
    height: 6px;
    -webkit-appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
}

.candy-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    background: #ff69b4;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
}

.candy-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 10px rgba(255, 105, 180, 0.5);
}

.candy-select {
    padding: 8px 15px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    min-width: 150px;
}

.candy-select option {
    background: #1a1a2e;
}

.candy-toggle {
    width: 50px;
    height: 26px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 13px;
    position: relative;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    padding: 0;
}

.candy-toggle:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

.candy-toggle--active {
    background: #ff69b4;
}

.candy-toggle__handle {
    width: 22px;
    height: 22px;
    background: #fff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: all 0.2s;
}

.candy-toggle--active .candy-toggle__handle {
    left: 26px;
}

.candy-keybind {
    padding: 8px 15px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    min-width: 80px;
    text-align: center;
    transition: all 0.2s;
}

.candy-keybind:hover {
    border-color: #ff69b4;
    background: rgba(255, 105, 180, 0.1);
}

.candy-keybind:active {
    transform: scale(0.95);
    transition-duration: 0.05s;
}

.candy-keybind:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

.candy-keybind--listening {
    border-color: #ffd700;
    background: rgba(255, 215, 0, 0.2);
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* Import/Export Area */
.candy-io-area {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 15px;
}

.candy-io-area__label {
    color: #888;
    font-size: 12px;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.candy-textarea {
    width: 100%;
    min-height: 150px;
    padding: 15px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-family: monospace;
    font-size: 12px;
    resize: vertical;
    box-sizing: border-box;
}

.candy-textarea:focus {
    outline: none;
    border-color: #ff69b4;
}

.candy-file-input {
    display: none;
}

.candy-file-label {
    display: inline-block;
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-radius: 25px;
    cursor: pointer;
    transition: all 0.2s;
    margin-right: 10px;
}

.candy-file-label:hover {
    background: rgba(255, 255, 255, 0.2);
}

.candy-file-label:active {
    transform: scale(0.95);
    transition-duration: 0.05s;
}

.candy-file-label:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px #1a1a2e, 0 0 0 6px #ff4081;
    position: relative;
    z-index: 10;
}

/* Danger Zone */
.candy-danger-zone {
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin-top: 30px;
}

.candy-danger-zone__title {
    color: #ef4444;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.candy-danger-zone__text {
    color: #aaa;
    font-size: 14px;
    margin-bottom: 15px;
}

/* Loading State */
.candy-save-menu__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: #fff;
}

.candy-save-menu__spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #ff69b4;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 15px;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Empty State */
.candy-empty-state {
    text-align: center;
    padding: 40px;
    color: #888;
}

.candy-empty-state__icon {
    font-size: 48px;
    margin-bottom: 15px;
}

.candy-empty-state__text {
    font-size: 16px;
}

/* Toast Notification Override */
.candy-save-toast {
    position: fixed;
    bottom: 80px;
    right: 20px;
    background: rgba(30, 30, 40, 0.95);
    color: #fff;
    padding: 15px 20px;
    border-radius: 10px;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 10001;
    animation: slideInRight 0.3s ease;
}

@keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

/* Scrollbar Styling */
.candy-save-menu__container::-webkit-scrollbar {
    width: 8px;
}

.candy-save-menu__container::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
}

.candy-save-menu__container::-webkit-scrollbar-thumb {
    background: rgba(255, 105, 180, 0.5);
    border-radius: 4px;
}

.candy-save-menu__container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 105, 180, 0.8);
}
`;

export default MENU_STYLES;
