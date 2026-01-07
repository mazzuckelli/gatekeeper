import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err: any) {
      console.error('Sign out error:', err.message);
    }
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <div className="layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <h1>GATEKEEPER</h1>
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={closeMobileMenu}>
          <nav className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <p className="user-email">{user?.email}</p>
            </div>
            <div className="mobile-nav-links">
              <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} end onClick={closeMobileMenu}>
                <span className="nav-icon">🏠</span>
                Dashboard
              </NavLink>
              <NavLink to="/profile" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={closeMobileMenu}>
                <span className="nav-icon">👤</span>
                Profile
              </NavLink>
              <NavLink to="/security" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={closeMobileMenu}>
                <span className="nav-icon">🔒</span>
                Security
              </NavLink>
              <NavLink to="/developer" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={closeMobileMenu}>
                <span className="nav-icon">🛠️</span>
                Developer
              </NavLink>
            </div>
            <div className="mobile-menu-footer">
              <button className="btn-signout-sidebar" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          </nav>
        </div>
      )}

      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>GATEKEEPER</h1>
          <p className="user-email">{user?.email}</p>
        </div>

        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} end>
            <span className="nav-icon">🏠</span>
            Dashboard
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">👤</span>
            Profile
          </NavLink>
          <NavLink to="/security" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">🔒</span>
            Security
          </NavLink>
          <NavLink to="/developer" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">🛠️</span>
            Developer
          </NavLink>
        </div>

        <div className="sidebar-footer">
          <button className="btn-signout-sidebar" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
