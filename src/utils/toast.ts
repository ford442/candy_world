/**
 * Toast notification utility
 * Displays a temporary notification to the user
 */

import { announce } from '../ui/announcer.ts';

/**
 * Shows a toast notification
 * @param message - The message to display
 * @param icon - Emoji icon to show (default: '✨')
 * @param duration - How long to show in ms (default: 4000)
 */
export function showToast(message: string, icon: string = '✨', duration: number = 4000): void {
    announce(message, 'polite');
    const toast = document.getElementById('now-playing-toast');
    const toastText = document.getElementById('now-playing-text') as HTMLElement | null;

    if (toast && toastText) {
        const toastIcon = toast.querySelector('.icon') as HTMLElement | null;
        toastText.innerText = message;
        if (toastIcon) toastIcon.innerText = icon;

        toast.classList.add('visible');

        // Clear existing timeout if any
        if ((toast as HTMLElement & { timeout?: number }).timeout) {
            clearTimeout((toast as HTMLElement & { timeout?: number }).timeout);
        }
        
        (toast as HTMLElement & { timeout?: number }).timeout = window.setTimeout(() => {
            toast.classList.remove('visible');
        }, duration);
    }
}
