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
    try {
      const valueToStore = typeof v === 'function' ? v(state) : v;
      setState(valueToStore);
      localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (e) {
      console.error('useLocalStorage set error', e);
    }
  };

  return [state, setValue];
}