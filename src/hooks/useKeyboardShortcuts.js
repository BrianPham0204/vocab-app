// ...new file...
import { useEffect } from 'react';

export default function useKeyboardShortcuts({ onNext, onSpeak, deps = [] }) {
  useEffect(() => {
    const handler = (e) => {
      const key = e.key;
      const tgt = e.target;
      const tag = tgt && tgt.tagName && String(tgt.tagName).toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || tgt?.isContentEditable || tag === 'select';

      if (key === 'Tab') {
        if (isEditable) return;
        e.preventDefault();
        try { onNext(); } catch (err) { /* ignore */ }
        return;
      }

      if (key && key.toLowerCase() === 'v') {
        if (isEditable) return;
        e.preventDefault();
        try { onSpeak(); } catch (err) { /* ignore */ }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // deps should include everything that affects onNext/onSpeak behavior
  }, deps);
}
// ...end file...