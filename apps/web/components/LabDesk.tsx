"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * The Lab's modular desk.
 *
 * Windows live in columns — to the right of the dock, then under it — and
 * never overlap. Dragging a window by its header carries it with the pointer;
 * passing over another window swaps them, passing over the empty foot of a
 * column moves it there. Released, it glides into its slot. A column whose
 * windows don't fit squeezes them (each scrolls inside) so the desk itself
 * never needs to.
 *
 * Every load starts tidied, as does entering or leaving full screen and any
 * change in how many columns fit.
 *
 * Below the desk breakpoint the same windows are collapsed sections in a
 * single column, so one tree serves phones too.
 */

/** Wide enough and tall enough to float windows; a landscape phone is neither. */
export const DESK_QUERY = "(min-width: 768px) and (min-height: 600px)";
const GAP = 8;
const MIN_COL = 240;
/** Vertical padding of .lab-win-body plus the window's borders. */
const CHROME_Y = 20;
/** Smallest a squeezed, open window may get. */
const MIN_OPEN = 96;

const isDesk = () => window.matchMedia(DESK_QUERY).matches;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Slot {
  x: number;
  y: number;
  h: number;
}

const boxOf = (el: HTMLElement): Rect => ({
  x: el.offsetLeft,
  y: el.offsetTop,
  w: el.offsetWidth,
  h: el.offsetHeight,
});
const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Column rects: right of the dock first, then under it, all one width. */
function geometry(desk: HTMLElement, dock: HTMLElement): { cols: Rect[]; cw: number } {
  const W = desk.clientWidth;
  const H = desk.clientHeight;
  const d = boxOf(dock);
  const rx = d.x + d.w + GAP;
  const rw = W - rx;
  const n = Math.max(1, Math.floor((rw + GAP) / (MIN_COL + GAP)));
  const cw = Math.floor((rw - GAP * (n - 1)) / n);
  const cols: Rect[] = [];
  for (let i = 0; i < n; i++) cols.push({ x: rx + i * (cw + GAP), y: 0, w: cw, h: H });
  const by = d.y + d.h + GAP;
  if (H - by >= 160) {
    const n2 = Math.floor((d.w + GAP) / (cw + GAP));
    for (let i = 0; i < n2; i++) cols.push({ x: i * (cw + GAP), y: by, w: cw, h: H - by });
  }
  return { cols, cw };
}

/**
 * Heights for one column's windows within `room`. Water-filling: windows
 * shorter than a fair share keep their height; the rest split what's left.
 */
function squeeze(natural: number[], floors: number[], room: number): number[] {
  const out = natural.slice();
  if (natural.reduce((a, b) => a + b, 0) <= room) return out;
  const idx = natural.map((_, i) => i).sort((a, b) => natural[a] - natural[b]);
  let left = room;
  for (let k = 0; k < idx.length; k++) {
    const fair = left / (idx.length - k);
    const i = idx[k];
    out[i] = Math.max(floors[i], Math.min(natural[i], fair));
    left -= out[i];
  }
  return out;
}

export interface Desk {
  slots: Record<string, Slot>;
  width: number;
  min: Record<string, boolean>;
  grab: (e: ReactPointerEvent, id: string) => void;
  toggleMin: (id: string) => void;
  tidy: () => void;
}

export function useDesk(
  deskRef: RefObject<HTMLDivElement>,
  dockRef: RefObject<HTMLDivElement>,
  /** Re-tidy when this changes (entering or leaving full screen). */
  mode: unknown,
): Desk {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [width, setWidth] = useState(0);
  const [min, setMin] = useState<Record<string, boolean>>({});

  const columns = useRef<string[][]>([]);
  const colCount = useRef(0);
  const pendingTidy = useRef(true);
  const minRef = useRef(min);
  minRef.current = min;
  const widthRef = useRef(width);
  widthRef.current = width;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const geo = useRef<{ cols: Rect[]; cw: number }>({ cols: [], cw: 0 });

  const windows = useCallback(
    () => Array.from(deskRef.current?.querySelectorAll<HTMLElement>(".lab-win") ?? []),
    [deskRef],
  );

  const relayout = useCallback(() => {
    const desk = deskRef.current;
    const dock = dockRef.current;
    if (!desk || !dock) return;
    if (!isDesk()) {
      pendingTidy.current = true;
      if (Object.keys(slotsRef.current).length) setSlots({});
      return;
    }
    const g = geometry(desk, dock);
    geo.current = g;
    // Width first: heights are only meaningful once windows are at column width.
    if (g.cw !== widthRef.current) {
      setWidth(g.cw);
      return;
    }
    if (g.cols.length !== colCount.current) {
      colCount.current = g.cols.length;
      pendingTidy.current = true;
    }

    const els = new Map(windows().map((el) => [el.dataset.win!, el]));
    const natural = (id: string) => {
      const el = els.get(id)!;
      const head = el.querySelector<HTMLElement>(".lab-win-head")!.offsetHeight;
      if (minRef.current[id]) return head + 2;
      return head + el.querySelector<HTMLElement>(".lab-win-inner")!.offsetHeight + CHROME_Y;
    };
    const floor = (id: string) => (minRef.current[id] ? natural(id) : Math.min(natural(id), MIN_OPEN));

    let cols = columns.current.map((c) => c.filter((id) => els.has(id)));
    const placed = new Set(cols.flat());
    const fresh = [...els.keys()].filter((id) => !placed.has(id));

    const used = (c: string[]) => c.reduce((a, id) => a + natural(id) + GAP, 0);
    if (pendingTidy.current) {
      // First fit, in document order.
      pendingTidy.current = false;
      cols = g.cols.map(() => []);
      for (const id of els.keys()) {
        const h = natural(id);
        let c = cols.findIndex((col, i) => used(col) + h <= g.cols[i].h);
        if (c < 0) c = cols.reduce((b, col, i) => (used(col) / g.cols[i].h < used(cols[b]) / g.cols[b].h ? i : b), 0);
        cols[c].push(id);
      }
    } else {
      while (cols.length < g.cols.length) cols.push([]);
      // New windows (a detached section) go to the emptiest column.
      for (const id of fresh) {
        const c = cols.reduce((b, col, i) => (used(col) / g.cols[i].h < used(cols[b]) / g.cols[b].h ? i : b), 0);
        cols[c].push(id);
      }
    }
    columns.current = cols;

    const next: Record<string, Slot> = {};
    cols.forEach((col, i) => {
      const r = g.cols[i];
      const hs = squeeze(col.map(natural), col.map(floor), r.h - GAP * Math.max(0, col.length - 1));
      let y = r.y;
      col.forEach((id, k) => {
        next[id] = { x: r.x, y, h: hs[k] };
        y += hs[k] + GAP;
      });
    });
    const prev = slotsRef.current;
    const same =
      Object.keys(next).length === Object.keys(prev).length &&
      Object.entries(next).every(
        ([id, s]) => prev[id] && prev[id].x === s.x && prev[id].y === s.y && Math.abs(prev[id].h - s.h) < 1,
      );
    if (!same) setSlots(next);
  }, [deskRef, dockRef, windows]);

  const schedule = useRef(0);
  const soon = useCallback(() => {
    cancelAnimationFrame(schedule.current);
    schedule.current = requestAnimationFrame(relayout);
  }, [relayout]);

  // Watch the desk, the dock, and every window's content for size changes.
  useLayoutEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    const ro = new ResizeObserver(soon);
    const observeAll = () => {
      ro.disconnect();
      ro.observe(desk);
      if (dockRef.current) ro.observe(dockRef.current);
      desk.querySelectorAll(".lab-win-inner").forEach((el) => ro.observe(el));
    };
    observeAll();
    // windows come and go (detached sections): re-observe on child changes
    const mo = new MutationObserver(() => {
      observeAll();
      soon();
    });
    mo.observe(desk, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(schedule.current);
    };
  }, [deskRef, dockRef, soon]);

  useLayoutEffect(() => {
    pendingTidy.current = true;
    soon();
  }, [mode, soon]);

  useEffect(() => {
    relayout();
  }, [width, min, relayout]);

  const grab = useCallback(
    (e: ReactPointerEvent, id: string) => {
      const desk = deskRef.current;
      if (!desk || !isDesk() || e.button !== 0) return;
      const head = e.currentTarget as HTMLElement;
      const win = head.closest<HTMLElement>(".lab-win")!;
      head.setPointerCapture(e.pointerId);
      e.preventDefault();

      const origin = desk.getBoundingClientRect();
      const start = slotsRef.current[id];
      if (!start) return;
      const ox = e.clientX - origin.left - start.x;
      const oy = e.clientY - origin.top - start.y;
      let last: string | null = null;
      win.classList.add("dragging");

      const move = (ev: PointerEvent) => {
        const px = ev.clientX - origin.left;
        const py = ev.clientY - origin.top;
        win.style.left = `${px - ox}px`;
        win.style.top = `${py - oy}px`;

        const cols = columns.current;
        const at = cols.findIndex((c) => c.includes(id));
        const s = slotsRef.current;
        const w = widthRef.current;
        const target = Object.keys(s).find(
          (o) => o !== id && inside({ x: s[o].x, y: s[o].y, w, h: s[o].h }, px, py),
        );
        if (target) {
          if (target === last) return;
          last = target;
          const tc = cols.findIndex((c) => c.includes(target));
          const ti = cols[tc].indexOf(target);
          const mi = cols[at].indexOf(id);
          cols[tc][ti] = id;
          cols[at][mi] = target;
          relayout();
          return;
        }
        last = null;
        // The empty foot of a column: move there, to the end.
        const c = geo.current.cols.findIndex((r) => inside(r, px, py));
        if (c < 0 || (c === at && cols[c][cols[c].length - 1] === id)) return;
        const foot = cols[c].reduce((y, o) => Math.max(y, s[o] ? s[o].y + s[o].h : 0), geo.current.cols[c].y);
        if (py < foot) return;
        cols[at] = cols[at].filter((o) => o !== id);
        cols[c].push(id);
        relayout();
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        head.removeEventListener("pointercancel", up);
        win.classList.remove("dragging");
        win.style.left = "";
        win.style.top = "";
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
      head.addEventListener("pointercancel", up);
    },
    [deskRef, relayout],
  );

  const toggleMin = useCallback((id: string) => setMin((m) => ({ ...m, [id]: !m[id] })), []);

  const tidy = useCallback(() => {
    setMin({});
    pendingTidy.current = true;
    soon();
  }, [soon]);

  return { slots, width, min, grab, toggleMin, tidy };
}

/**
 * One module. On the desk: a window in the grid with a drag header and a
 * minimise toggle. Below the breakpoint: a section, collapsed until tapped.
 */
export function LabWindow({
  id,
  title,
  desk,
  actions,
  children,
}: {
  id: string;
  title: string;
  desk: Desk;
  /** Extra header buttons (desk only), e.g. detach / dock. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const s = desk.slots[id];
  const min = desk.min[id];
  const style = {
    "--x": `${s?.x ?? 0}px`,
    "--y": `${s?.y ?? 0}px`,
    "--h": s ? `${s.h}px` : "none",
    "--w": desk.width ? `${desk.width}px` : undefined,
  } as CSSProperties;
  const cls = ["lab-win", s && "placed", min && "min", open && "open"].filter(Boolean).join(" ");

  return (
    <section className={cls} data-win={id} style={style}>
      <header
        className="lab-win-head"
        onPointerDown={(e) => desk.grab(e, id)}
        onClick={() => !isDesk() && setOpen((o) => !o)}
      >
        <span className="lab-win-grip" aria-hidden>
          ⠿
        </span>
        <span className="mono-label">{title}</span>
        {actions && (
          <span className="lab-win-actions" onPointerDown={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
        <button
          className="lab-win-toggle"
          aria-label={`${min || !open ? "Expand" : "Collapse"} ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (isDesk()) desk.toggleMin(id);
            else setOpen((o) => !o);
          }}
        >
          <span className="on-desk">{min ? "+" : "–"}</span>
          <span className="off-desk">{open ? "–" : "+"}</span>
        </button>
      </header>
      <div className="lab-win-body">
        <div className="lab-win-inner">{children}</div>
      </div>
    </section>
  );
}
