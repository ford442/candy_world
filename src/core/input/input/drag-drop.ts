import { showToast } from '../../../utils/toast.ts';
import { filterValidMusicFiles } from '../input-types.ts';
import type { InputSession } from './session.ts';

export interface DragDropHandlers {
    onDragEnter: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
}

export function setupDragDrop(session: InputSession): DragDropHandlers | null {
    session.dragOverlay = document.getElementById('drag-overlay');
    session.dragCounter = 0;

    const onDragEnter = (e: DragEvent) => {
        e.preventDefault();
        session.dragCounter++;
        if (session.dragOverlay) {
            session.dragOverlay.classList.add('active');
            session.dragOverlay.setAttribute('aria-hidden', 'false');
        }
    };

    const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        session.dragCounter--;
        if (session.dragCounter <= 0) {
            session.dragCounter = 0;
            if (session.dragOverlay) {
                session.dragOverlay.classList.remove('active');
                session.dragOverlay.setAttribute('aria-hidden', 'true');
            }
        }
    };

    const onDragOver = (e: DragEvent) => {
        e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        session.dragCounter = 0;
        if (session.dragOverlay) {
            session.dragOverlay.classList.remove('active');
            session.dragOverlay.setAttribute('aria-hidden', 'true');
        }

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const { validFiles, invalidFiles } = filterValidMusicFiles(files);

            if (validFiles.length > 0) {
                session.audioSystem.addToQueue(validFiles);

                if (invalidFiles.length > 0) {
                    showToast(
                        `Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`,
                        '⚠️'
                    );
                } else {
                    showToast(
                        `Added ${validFiles.length} Song${validFiles.length > 1 ? 's' : ''}! 🎶`,
                        '📂'
                    );
                }
            } else {
                showToast('❌ Only .mod, .xm, .it, .s3m allowed!', '🚫');
            }
        }
    };

    if (session.dragOverlay) {
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('drop', onDrop);
        return { onDragEnter, onDragLeave, onDragOver, onDrop };
    }

    return null;
}
