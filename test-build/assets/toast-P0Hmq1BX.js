function showToast(message, icon = '✨', duration = 4000) {
    const toast = document.getElementById('now-playing-toast');
    const toastText = document.getElementById('now-playing-text');

    if (toast && toastText) {
        const toastIcon = toast.querySelector('.icon');
        toastText.innerText = message;
        if (toastIcon) toastIcon.innerText = icon;

        toast.classList.add('visible');

        if (toast.timeout) clearTimeout(toast.timeout);
        toast.timeout = setTimeout(() => {
            toast.classList.remove('visible');
        }, duration);
    }
}

export { showToast };
//# sourceMappingURL=toast-P0Hmq1BX.js.map
