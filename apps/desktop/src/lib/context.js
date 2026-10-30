import { createContext, useContext } from 'react';
import { formatRupees } from './format';

export const AppContext = createContext(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext');
  return value;
}

/** Formats paise as rupees, e.g. 12345600 -> ₹1,23,456.00 */
export function useMoney() {
  return formatRupees;
}
