import { useState } from 'react';

export function useLocalStorage(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (v) => {
    setState((prev) => {
      const valueToStore = typeof v === 'function' ? v(prev) : v;
      try {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (e) {
        console.warn(`useLocalStorage persist error for ${key}`, e);
      }
      return valueToStore;
    });
  };

  return [state, setValue];
}
