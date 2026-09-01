// Icon shim — re-exports pixelarticons (https://pixelarticons.com, MIT) under the exact
// names every component already imports from 'lucide-react', so swapping the icon set is a
// one-line import-source change per file, not a call-site rename. Two icons (Dumbbell,
// Utensils) have no pixelarticons equivalent and are hand-drawn below on the same
// `viewBox="0 0 24 24" fill="currentColor"` convention pixelarticons itself uses.
//
// pixelarticons components don't have lucide's `size` prop (only raw `width`/`height`), so
// every icon is wrapped through `wrap()` to translate `size` -> `width`/`height` and keep
// `color`/`style`/`className` passing straight through unchanged.

import {
  Plus as PaPlus,
  Trash as PaTrash,
  Pencil as PaPencil,
  Close as PaClose,
  SquareAlert as PaSquareAlert,
  Building as PaBuilding,
  Coins as PaCoins,
  Lock as PaLock,
  Target as PaTarget,
  Waves as PaWaves,
  Check as PaCheck,
  Sparkles as PaSparkles,
  Send as PaSend,
  Robot as PaRobot,
  Download as PaDownload,
  Upload as PaUpload,
  Shield as PaShield,
  Layout as PaLayout,
  CreditCard as PaCreditCard,
  Clipboard as PaClipboard,
  Calendar2 as PaCalendar2,
  ArrowBarDown as PaArrowBarDown,
  ArrowBarUp as PaArrowBarUp,
  Banknote as PaBanknote,
  Fire as PaFire,
  ArrowRight as PaArrowRight,
  Camera as PaCamera,
  Hourglass as PaHourglass,
  BellRing as PaBellRing,
  Archive as PaArchive,
  Copy as PaCopy,
  Calendar as PaCalendar,
  Bell as PaBell,
  ChevronLeft as PaChevronLeft,
  Trophy as PaTrophy,
  Clock as PaClock,
  Unlock as PaUnlock,
  Smartphone as PaSmartphone,
  InfoBox as PaInfoBox,
  ArrowDownBox as PaArrowDownBox,
  CircleQuestion as PaCircleQuestion,
  Play as PaPlay,
  Pause as PaPause,
  CheckDouble as PaCheckDouble,
  Repeat as PaRepeat,
  Heart as PaHeart,
  Scale as PaScale,
  Cloud as PaCloud,
  Refresh as PaRefresh,
  Logout as PaLogout,
  Radio as PaRadio,
  SortHorizontal as PaSortHorizontal,
  Notes as PaNotes,
  Search as PaSearch,
  Star as PaStar,
  Bookmark as PaBookmark,
  AlarmClock as PaAlarmClock,
  Checkbox as PaCheckbox,
  CheckboxOn as PaCheckboxOn,
  Folder as PaFolder,
  ChevronRight as PaChevronRight,
  ChevronDown as PaChevronDown,
  Label as PaLabel,
  Inbox as PaInbox,
} from 'pixelarticons/react';

const wrap = (Icon) => {
  const Wrapped = ({ size = 24, ...rest }) => <Icon width={size} height={size} {...rest} />;
  Wrapped.displayName = `Icon(${Icon.name || 'pixelarticons'})`;
  return Wrapped;
};

export const Plus = wrap(PaPlus);
export const Trash2 = wrap(PaTrash);
export const Pencil = wrap(PaPencil);
export const X = wrap(PaClose);
export const AlertTriangle = wrap(PaSquareAlert);
export const Landmark = wrap(PaBuilding);
export const HandCoins = wrap(PaCoins);
export const Lock = wrap(PaLock);
export const Target = wrap(PaTarget);
export const Waves = wrap(PaWaves);
export const Check = wrap(PaCheck);
export const Sparkles = wrap(PaSparkles);
export const Send = wrap(PaSend);
export const Bot = wrap(PaRobot);
export const Download = wrap(PaDownload);
export const Upload = wrap(PaUpload);
export const ShieldCheck = wrap(PaShield);
export const LayoutDashboard = wrap(PaLayout);
export const Wallet = wrap(PaCreditCard);
export const ClipboardPaste = wrap(PaClipboard);
export const CalendarClock = wrap(PaCalendar2);
export const ArrowDownToLine = wrap(PaArrowBarDown);
export const ArrowUpFromLine = wrap(PaArrowBarUp);
export const Banknote = wrap(PaBanknote);
export const Flame = wrap(PaFire);
export const ArrowRight = wrap(PaArrowRight);
export const Camera = wrap(PaCamera);
export const Timer = wrap(PaHourglass);
export const BellRing = wrap(PaBellRing);
export const History = wrap(PaArchive);
// Same glyph, different meaning at the call site: History browses past days,
// Archive files an account away. Aliased rather than reused so a future icon
// swap can change one without silently changing the other.
export const Archive = wrap(PaArchive);
export const CalendarDays = wrap(PaCalendar);
export const Bell = wrap(PaBell);
export const ChevronLeft = wrap(PaChevronLeft);
export const Trophy = wrap(PaTrophy);
export const Clock = wrap(PaClock);
export const ShieldAlert = wrap(PaSquareAlert);
export const Unlock = wrap(PaUnlock);
export const Smartphone = wrap(PaSmartphone);
export const Info = wrap(PaInfoBox);
export const ArrowDownLeft = wrap(PaArrowDownBox);
export const HelpCircle = wrap(PaCircleQuestion);
export const Play = wrap(PaPlay);
export const Pause = wrap(PaPause);
export const CheckCircle = wrap(PaCheckDouble);
export const Repeat = wrap(PaRepeat);
export const HeartPulse = wrap(PaHeart);
export const Scale = wrap(PaScale);
export const Cloud = wrap(PaCloud);
export const CloudOff = wrap(PaCloud);
export const RefreshCw = wrap(PaRefresh);
export const LogOut = wrap(PaLogout);
export const Radio = wrap(PaRadio);
// Two horizontal arrows pointing opposite ways — the closest thing in this set
// to a swap glyph, and exactly right for money moving between two accounts.
export const ArrowRightLeft = wrap(PaSortHorizontal);
export const Copy = wrap(PaCopy);

// --- Life Hub (notes / reminders / special days) ---------------------------
export const StickyNote = wrap(PaNotes);
export const Search = wrap(PaSearch);
export const Star = wrap(PaStar);
// A bookmark is the closest thing in this set to a pushpin, and it already
// means "keep this one where I can find it" — which is what pinning a note is.
export const Pin = wrap(PaBookmark);
export const AlarmClock = wrap(PaAlarmClock);
export const Square = wrap(PaCheckbox);
export const CheckSquare = wrap(PaCheckboxOn);
export const Folder = wrap(PaFolder);
export const ChevronRight = wrap(PaChevronRight);
export const ChevronDown = wrap(PaChevronDown);
export const Tag = wrap(PaLabel);

// --- Supplements -----------------------------------------------------------
// A container with something in it — used for the supplement shelf and for the
// "running low" state, which is the only place stock is ever mentioned.
export const Package = wrap(PaInbox);

// No pixelarticons equivalent exists for these two — hand-drawn on the same 24x24 /
// fill="currentColor" / flat-rect convention so they sit unnoticed among the rest.
export function Dumbbell({ size = 24, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...rest}>
      <rect x="2" y="7" width="4" height="10" />
      <rect x="6" y="10" width="2" height="4" />
      <rect x="8" y="11" width="8" height="2" />
      <rect x="16" y="10" width="2" height="4" />
      <rect x="18" y="7" width="4" height="10" />
    </svg>
  );
}

export function Utensils({ size = 24, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...rest}>
      <rect x="3" y="2" width="1.5" height="7" />
      <rect x="5.25" y="2" width="1.5" height="7" />
      <rect x="7.5" y="2" width="1.5" height="7" />
      <rect x="3" y="9" width="6" height="2" />
      <rect x="5" y="11" width="2" height="11" />
      <rect x="13" y="2" width="4" height="8" />
      <rect x="14" y="10" width="2" height="12" />
    </svg>
  );
}
