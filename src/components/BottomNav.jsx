import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Utensils, Dumbbell, Wallet, Sparkles, Plus } from '../utils/icons';

// The screens the centre button leads to. Used only to keep it lit while you
// are on one of them — none of the four tabs is active there, and a nav bar
// with nothing highlighted reads as "you are nowhere".
const HUB_ROUTES = ['notes', 'reminders', 'special'];

export default function BottomNav({ onToggleHub, hubOpen }) {
  const location = useLocation();
  const onHubRoute = HUB_ROUTES.includes(location.pathname.split('/')[1]);

  return (
    <div className={`bottom-nav-wrapper${hubOpen ? ' hub-open' : ''}`}>
      <nav className="bottom-nav">
        {/* Overview Tab */}
        <NavLink
          to="/dashboard"
          className={({ isActive }) => `nav-item nav-dashboard ${isActive ? 'active' : ''}`}
        >
          <div className="nav-icon-wrapper">
            <LayoutDashboard size={18} />
          </div>
          <span className="nav-label">概览</span>
        </NavLink>

        {/* Diet AI Tab */}
        <NavLink
          to="/diet"
          className={({ isActive }) => `nav-item nav-diet ${isActive ? 'active' : ''}`}
        >
          <div className="nav-icon-wrapper">
            <Utensils size={18} />
          </div>
          <span className="nav-label">饮食</span>
        </NavLink>

        {/* Center Life Hub button. It used to open the AI assistant and
            nothing else, which made the most reachable control on the screen a
            shortcut to ONE feature. The assistant is still here — it's now one
            of the four things this unfolds into. */}
        <button
          className={`fab-ai-btn${hubOpen ? ' open' : ''}${onHubRoute ? ' on-hub-route' : ''}`}
          onClick={onToggleHub}
          aria-expanded={hubOpen}
          aria-label={hubOpen ? '关闭' : '记事本 · AI · 提醒 · 特别的日子'}
          title={hubOpen ? '关闭' : '记事本 · AI · 提醒 · 特别的日子'}
        >
          {hubOpen
            ? <Plus size={22} className="fab-ai-icon" />
            : <Sparkles size={20} className="fab-ai-icon" />}
          <span className="fab-pulse-ring" />
        </button>

        {/* Sports Tab — prefix match (no `end`) so /sports/strength etc. still
            lights this up */}
        <NavLink
          to="/sports"
          className={({ isActive }) => `nav-item nav-sports ${isActive ? 'active' : ''}`}
        >
          <div className="nav-icon-wrapper">
            <Dumbbell size={18} />
          </div>
          <span className="nav-label">健身</span>
        </NavLink>

        {/* Money Tab — same prefix-match reasoning for /money/cycle etc. */}
        <NavLink
          to="/money"
          className={({ isActive }) => `nav-item nav-money ${isActive ? 'active' : ''}`}
        >
          <div className="nav-icon-wrapper">
            <Wallet size={18} />
          </div>
          <span className="nav-label">记账</span>
        </NavLink>
      </nav>
    </div>
  );
}
