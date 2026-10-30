import { createContext, useContext } from 'react';
import { formatMoney } from './format';

export const AppContext = createContext(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext');
  return value;
}

export function useMoney() {
  const { settings } = useApp();
  return (cents) => formatMoney(cents, settings?.currency ?? 'USD');
}
