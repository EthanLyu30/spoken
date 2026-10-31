import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { recordSiteVisit } from '../lib/siteVisits';

export function SiteVisitTracker() {
  const { pathname } = useLocation();
  const user = useAuth(state => state.user);
  const last = useRef('');
  useEffect(() => {
    if (pathname === '/admin' || pathname.startsWith('/admin/') || user?.is_admin) return;
    const key = `${pathname}|${user?.id ?? 'guest'}`;
    if (last.current === key) return;
    last.current = key;
    void recordSiteVisit();
  }, [pathname, user?.id, user?.is_admin]);
  return null;
}
