'use client';

import Link from 'next/link';
import { useAuth } from '../context/AuthContext';



export default function AppShell({ children }) {
  const { user, logout } = useAuth();

  return (
    <>
      <nav className="top-nav">
        
        {/* <div className="nav-links">
          <Link href="/music">Music</Link>
          <Link href="/fan-dashboard">Fan Dashboard</Link>
          {user?.role === 'artist' ? <Link href="/artist-dashboard">Artist Dashboard</Link> : null}
          <Link href={user ? '/account' : '/auth'}>{user ? 'Account' : 'Sign in'}</Link>
          {user ? <button className="nav-logout" onClick={logout}>Logout</button> : null}
        </div> */}
      </nav>
      {children}
    </>
  );
}
