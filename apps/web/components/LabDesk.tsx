"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * The Lab's modular desk.
 *
 * Every window has a column and a place in that column's stack; windows stack
 * from the top with no gaps (a two-column window sits below the taller of its
 * two stacks). Dragging works like a sortable list across columns: the column
 * is the one nearest the dragged window's left edge, and it lands above the
 * first window there whose middle is below the pointer — so it can go on top,
 * between, or below anything. The rest slide aside live.
 *
 * Tidy, the dice, first load and any change in the number of columns lay the
 * windows out automatically instead: skyline-packed, each where its span of
 * columns is lowest, honouring the default column pins until the user
 * rearranges.
 *
 * Each window can be resized from its corner: one or two columns wide, and
 * any height between a floor and its content's natural height — never taller,
 * so there is no dead space; shorter scrolls inside. Two-column windows flow
 * their content into two columns. Everything else re-packs around a resize.
 *
 * On the page the desk grows downward if it has to, and the page scrolls. In
 * the full modes it has to fit, so columns get narrower and more numerous
 * until everything does, down to a floor width.
 *
 * Below the desk breakpoint the same windows are collapsed sections in a
 * single column, so one tree serves phones too.
 */

/** Wide enough and tall enough to float windows; a landscape phone is neither. */
export const DESK_QUERY = "(min-width: 768px) and (min-height: 600px)";
export const GAP = 8;
/** Preferred column width. */
const MIN_COL = 280;
/** Narrowest a column gets when a full mode is making things fit. */
const MIN_COL_FIT = 210;
/** Widest a window may be, in columns. */
const MAX_SPAN = 2;
/** Shortest a resized open window may be. */
const MIN_H = 120;
/** .lab-win-body's vertical padding plus the window's borders. */
const CHROME_Y = 24;

const isDesk = () => window.matchMedia(DESK_QUERY).matches;

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Col {
  x: number;
  y: number;
  region: number;
}
/** What the user set by resizing. Absent fields mean the window's default. */
interface Size {
  span?: number;
  h?: number;
}

/**
 * Columns right of the dock, then under it, all one width. `n` is the right
 * region's column count; undefined means the preferred count.
 */
function geometry(desk: HTMLElement, dock: HTMLElement, n?: number) {
  const W = desk.clientWidth;
  const rx = dock.offsetLeft + dock.offsetWidth + GAP;
  const rw = W - rx;
  const base = Math.max(1, Math.floor((rw + GAP) / (MIN_COL + GAP)));
  const most = Math.max(base, Math.floor((rw + GAP) / (MIN_COL_FIT + GAP)));
  const count = Math.min(most, Math.max(base, n ?? base));
  const cw = Math.floor((rw - GAP * (count - 1)) / count);
  const cols: Col[] = [];
  for (let i = 0; i < count; i++) cols.push({ x: rx + i * (cw + GAP), y: 0, region: 0 });
  const by = dock.offsetTop + dock.offsetHeight + GAP;
  const under = Math.floor((dock.offsetWidth + GAP) / (cw + GAP));
  for (let i = 0; i < under; i++) cols.push({ x: i * (cw + GAP), y: by, region: 1 });
  return { cols, cw, count, most };
}

/**
 * Skyline pack: each window where its span of columns is currently lowest.
 * Windows with a `pin` column go first, stacked in that column, so a default
 * layout can say "these three down the left, the chain alone beside them".
 */
function pack(
  order: string[],
  height: (id: string) => number,
  span: (id: string) => number,
  pin: (id: string) => number | undefined,
  cols: Col[],
  cw: number,
) {
  const top = cols.map((c) => c.y);
  const slots: Record<string, Slot> = {};
  const right = cols.filter((c) => c.region === 0).length;
  const fits = (id: string) => {
    const p = pin(id);
    return p !== undefined && p + span(id) <= right;
  };
  for (const id of [...order.filter(fits), ...order.filter((id) => !fits(id))]) {
    let k = span(id);
    let best = -1;
    let bestY = Infinity;
    if (fits(id)) {
      best = pin(id)!;
      bestY = Math.max(...top.slice(best, best + k));
    }
    while (best < 0 && k >= 1) {
      for (let c = 0; c + k <= cols.length; c++) {
        if (cols[c + k - 1].region !== cols[c].region) continue;
        const y = Math.max(...top.slice(c, c + k));
        if (y < bestY) (bestY = y), (best = c);
      }
      if (best < 0) k--;
    }
    const h = height(id);
    slots[id] = { x: cols[best].x, y: bestY, w: k * cw + (k - 1) * GAP, h };
    for (let c = best; c < best + k; c++) top[c] = bestY + h + GAP;
  }
  const bottom = Math.max(0, ...Object.values(slots).map((s) => s.y + s.h));
  return { slots, bottom };
}

/** Nearest valid start for a span at column `c`: shifted left within its region, narrowed if the region is too small. */
function fitCol(c: number, k: number, cols: Col[]): [number, number] {
  const at = Math.max(0, Math.min(c, cols.length - 1));
  const region = cols.map((col, i) => (col.region === cols[at].region ? i : -1)).filter((i) => i >= 0);
  const span = Math.min(k, region.length);
  return [Math.min(at, region[region.length - span]), span];
}

/** Stack windows into their assigned columns, in sequence. */
function place(
  seq: string[],
  colOf: Record<string, number>,
  height: (id: string) => number,
  span: (id: string) => number,
  cols: Col[],
  cw: number,
) {
  const top = cols.map((c) => c.y);
  const slots: Record<string, Slot> = {};
  for (const id of seq) {
    const [c, k] = fitCol(colOf[id] ?? 0, span(id), cols);
    const y = Math.max(...top.slice(c, c + k));
    const h = height(id);
    slots[id] = { x: cols[c].x, y, w: k * cw + (k - 1) * GAP, h };
    for (let i = c; i < c + k; i++) top[i] = y + h + GAP;
  }
  const bottom = Math.max(0, ...Object.values(slots).map((s) => s.y + s.h));
  return { slots, bottom };
}

/** `seq` with any of `doc` it lacks inserted after their document predecessor. */
function merge(seq: string[], doc: string[]): string[] {
  const out = seq.filter((id) => doc.includes(id));
  doc.forEach((id, i) => {
    if (out.includes(id)) return;
    out.splice(i > 0 ? out.indexOf(doc[i - 1]) + 1 : 0, 0, id);
  });
  return out;
}

/** Windows in document order, a detail window (`sound-*`) kept with its parent. */
function blocks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (const id of ids) {
    const parent = out[out.length - 1];
    if (parent && id.startsWith(`${parent[0]}-`)) parent.push(id);
    else out.push([id]);
  }
  return out;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Desk {
  slots: Record<string, Slot>;
  /** Column width, for sizing windows before they are placed. */
  cw: number;
  /** Columns in the right-hand region; caps a window's span. */
  count: number;
  /** Height the packed windows need; the page desk grows to it. */
  bottom: number;
  min: Record<string, boolean>;
  sizes: Record<string, Size>;
  grab: (e: ReactPointerEvent, id: string) => void;
  resize: (e: ReactPointerEvent, id: string) => void;
  toggleMin: (id: string) => void;
  tidy: () => void;
  roll: () => void;
}

export function useDesk(
  deskRef: RefObject<HTMLDivElement>,
  dockRef: RefObject<HTMLDivElement>,
  /** Truthy in a full mode, where everything must fit. Changing it re-packs. */
  full: unknown,
): Desk {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [cw, setCw] = useState(0);
  const [count, setCount] = useState(1);
  const [bottom, setBottom] = useState(0);
  const [min, setMin] = useState<Record<string, boolean>>({});
  const [sizes, setSizes] = useState<Record<string, Size>>({});

  /** Stacking sequence: within a column, earlier is higher. */
  const seq = useRef<string[]>([]);
  /** Each window's (start) column. */
  const colOf = useRef<Record<string, number>>({});
  /** Next layout is automatic (tidy, dice, first load). */
  const auto = useRef(true);
  /** Default column pins apply until the user rearranges (drag or dice). */
  const pinned = useRef(true);
  const cols = useRef<number | undefined>(undefined);
  const colTotal = useRef(0);
  const geo = useRef<Col[]>([]);
  /** Natural (content) height per window, from the last layout. */
  const natural = useRef<Record<string, number>>({});
  const fullRef = useRef(full);
  fullRef.current = full;
  const minRef = useRef(min);
  minRef.current = min;
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const cwRef = useRef(cw);
  cwRef.current = cw;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const relayout = useCallback(() => {
    const desk = deskRef.current;
    const dock = dockRef.current;
    if (!desk || !dock) return;
    if (!isDesk()) {
      if (Object.keys(slotsRef.current).length) setSlots({});
      return;
    }
    const g = geometry(desk, dock, cols.current);
    setCount(g.count);
    // Width first: heights only mean something once windows are at column width.
    if (g.cw !== cwRef.current) {
      setCw(g.cw);
      return;
    }

    const els = new Map(
      Array.from(desk.querySelectorAll<HTMLElement>(".lab-win")).map((el) => [el.dataset.win!, el]),
    );
    const doc = [...els.keys()];

    for (const [id, el] of els) {
      const head = el.querySelector<HTMLElement>(".lab-win-head")!.offsetHeight;
      natural.current[id] = minRef.current[id]
        ? head + 2
        : head + el.querySelector<HTMLElement>(".lab-win-inner")!.offsetHeight + CHROME_Y;
    }
    const height = (id: string) => {
      const n = natural.current[id];
      const h = sizesRef.current[id]?.h;
      return minRef.current[id] || h === undefined ? n : Math.max(Math.min(MIN_H, n), Math.min(h, n));
    };
    const span = (id: string) => Math.min(g.count, Number(els.get(id)!.dataset.span ?? 1));
    const pin = (id: string) => {
      const c = els.get(id)!.dataset.col;
      return pinned.current && c !== undefined ? Number(c) : undefined;
    };

    geo.current = g.cols;
    if (g.cols.length !== colTotal.current) {
      colTotal.current = g.cols.length;
      auto.current = true;
    }
    if (doc.some((id) => colOf.current[id] === undefined)) auto.current = true;

    let packed;
    if (auto.current) {
      // Pinned: document order, which is the designed default. Otherwise the
      // user's sequence, with any new windows beside their predecessor.
      const order = pinned.current ? doc : merge(seq.current, doc);
      packed = pack(order, height, span, pin, g.cols, g.cw);
      // Full modes must fit: trade width for columns until they do.
      if (fullRef.current && packed.bottom > desk.clientHeight && g.count < g.most) {
        cols.current = g.count + 1;
        relayout();
        return;
      }
      const sl = packed.slots;
      colOf.current = Object.fromEntries(
        Object.entries(sl).map(([id, p]) => [id, g.cols.findIndex((c) => c.x === p.x)]),
      );
      seq.current = order.slice().sort((a, b) => sl[a].y - sl[b].y || sl[a].x - sl[b].x);
      auto.current = false;
    } else {
      seq.current = seq.current.filter((id) => els.has(id));
      packed = place(seq.current, colOf.current, height, span, g.cols, g.cw);
    }

    const prev = slotsRef.current;
    const same =
      Object.keys(packed.slots).length === Object.keys(prev).length &&
      Object.entries(packed.slots).every(
        ([id, s]) => prev[id] && prev[id].x === s.x && prev[id].y === s.y && prev[id].w === s.w && prev[id].h === s.h,
      );
    if (!same) setSlots(packed.slots);
    setBottom(packed.bottom);
  }, [deskRef, dockRef]);

  const raf = useRef(0);
  const soon = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(relayout);
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
    // windows come and go (advanced sound sections): re-observe
    const mo = new MutationObserver(() => {
      observeAll();
      soon();
    });
    mo.observe(desk, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [deskRef, dockRef, soon]);

  // Entering or leaving a full mode re-packs from the preferred column count,
  // keeping the user's arrangement order if they've made one.
  useLayoutEffect(() => {
    cols.current = undefined;
    auto.current = true;
    soon();
  }, [full, soon]);

  useLayoutEffect(() => {
    relayout();
  }, [cw, min, sizes, relayout]);

  /** Pointer position in desk coordinates, scroll included. */
  const deskPoint = (ev: { clientX: number; clientY: number }) => {
    const desk = deskRef.current!;
    const r = desk.getBoundingClientRect();
    return { x: ev.clientX - r.left + desk.scrollLeft, y: ev.clientY - r.top + desk.scrollTop };
  };

  /** Capture the pointer on `el` and route its moves until release. */
  const track = (e: ReactPointerEvent, move: (ev: PointerEvent) => void, done: () => void) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      done();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const grab = (e: ReactPointerEvent, id: string) => {
    if (!deskRef.current || !isDesk() || e.button !== 0 || !slotsRef.current[id]) return;
    const win = (e.currentTarget as HTMLElement).closest<HTMLElement>(".lab-win")!;
    const p0 = deskPoint(e);
    const s0 = slotsRef.current[id];
    const ox = p0.x - s0.x;
    const oy = p0.y - s0.y;
    const k = Number(win.dataset.span ?? 1);
    let last = "";
    win.classList.add("dragging");
    track(
      e,
      (ev) => {
        const p = deskPoint(ev);
        const left = p.x - ox;
        win.style.left = `${left}px`;
        win.style.top = `${p.y - oy}px`;

        // Column: nearest to the window's left edge. The under-dock columns
        // only count once the pointer is down among them.
        const cs = geo.current;
        let c = -1;
        cs.forEach((col, i) => {
          if (col.region !== 0 && p.y < col.y) return;
          if (c < 0 || Math.abs(col.x - left) < Math.abs(cs[c].x - left)) c = i;
        });
        if (c < 0) return;
        const [start, span] = fitCol(c, k, cs);

        // Place: above the first window sharing those columns whose middle is
        // below the pointer; otherwise at the bottom of them.
        const s = slotsRef.current;
        const shares = (o: string) => {
          const [oc, ok] = fitCol(colOf.current[o], Number(s[o] ? Math.round((s[o].w + GAP) / (cwRef.current + GAP)) : 1), cs);
          return oc < start + span && start < oc + ok;
        };
        const rest = seq.current.filter((o) => o !== id);
        const before = rest.find((o) => s[o] && shares(o) && s[o].y + s[o].h / 2 > p.y) ?? null;

        const key = `${start}:${before}`;
        if (key === last) return;
        last = key;
        const at = before ? rest.indexOf(before) : rest.length;
        rest.splice(at, 0, id);
        seq.current = rest;
        colOf.current = { ...colOf.current, [id]: start };
        pinned.current = false;
        relayout();
      },
      () => {
        win.classList.remove("dragging");
        win.style.left = "";
        win.style.top = "";
      },
    );
  };

  /**
   * Corner resize. Width snaps between one and two columns at the halfway
   * point; height runs between the floor and the content's natural height.
   * Everything re-packs live around it.
   */
  const resize = (e: ReactPointerEvent, id: string) => {
    if (!isDesk() || e.button !== 0 || !slotsRef.current[id]) return;
    const s0 = slotsRef.current[id];
    const x0 = e.clientX;
    const y0 = e.clientY;
    const win = (e.currentTarget as HTMLElement).closest<HTMLElement>(".lab-win")!;
    win.classList.add("resizing");
    let frame = 0;
    track(
      e,
      (ev) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const c = cwRef.current;
          const w = s0.w + ev.clientX - x0;
          const span = Math.max(1, Math.min(MAX_SPAN, Math.round((w + GAP) / (c + GAP))));
          const n = natural.current[id];
          const h = Math.max(Math.min(MIN_H, n), Math.min(n, s0.h + ev.clientY - y0));
          setSizes((z) => ({
            ...z,
            // at full height, store nothing: the window keeps tracking its content
            [id]: { span, h: h >= n - 1 ? undefined : h },
          }));
        });
      },
      () => {
        cancelAnimationFrame(frame);
        win.classList.remove("resizing");
      },
    );
  };

  const toggleMin = useCallback((id: string) => setMin((m) => ({ ...m, [id]: !m[id] })), []);

  /** Clean grid in document order; sizes and minimised windows are left as they are. */
  const tidy = useCallback(() => {
    pinned.current = true;
    auto.current = true;
    cols.current = undefined;
    soon();
  }, [soon]);

  /** A random layout: detail windows stay with their parent, spans are rerolled. */
  const roll = useCallback(() => {
    const ids = Array.from(deskRef.current?.querySelectorAll<HTMLElement>(".lab-win") ?? []).map(
      (el) => el.dataset.win!,
    );
    seq.current = shuffle(blocks(ids)).flat();
    pinned.current = false;
    auto.current = true;
    cols.current = undefined;
    setSizes((z) => {
      const next: Record<string, Size> = {};
      for (const id of ids) next[id] = { ...z[id], span: Math.random() < 0.35 ? 2 : 1 };
      return next;
    });
    soon();
  }, [deskRef, soon]);

  return { slots, cw, count, bottom, min, sizes, grab, resize, toggleMin, tidy, roll };
}

/**
 * One module. On the desk: a window in the grid with a drag header, a
 * minimise toggle and a resize corner. Below the breakpoint: a section,
 * collapsed until tapped.
 */
export function LabWindow({
  id,
  title,
  desk,
  span = 1,
  col,
  children,
}: {
  id: string;
  title: string;
  desk: Desk;
  /** Default columns spanned, until the user resizes. */
  span?: number;
  /** Default column, honoured on first load and by tidy. */
  col?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const s = desk.slots[id];
  const min = desk.min[id];
  const cols = Math.min(desk.count, desk.sizes[id]?.span ?? span);
  const w = s?.w ?? (desk.cw ? cols * desk.cw + (cols - 1) * GAP : 0);
  const style = {
    "--x": `${s?.x ?? 0}px`,
    "--y": `${s?.y ?? 0}px`,
    "--w": w ? `${w}px` : undefined,
    "--h": s ? `${s.h}px` : undefined,
  } as CSSProperties;
  const cls = ["lab-win", s && "placed", min && "min", open && "open"].filter(Boolean).join(" ");

  return (
    <section className={cls} data-win={id} data-span={cols} data-col={col} style={style}>
      <header
        className="lab-win-head"
        onPointerDown={(e) => desk.grab(e, id)}
        onClick={() => !isDesk() && setOpen((o) => !o)}
      >
        <span className="lab-win-grip" aria-hidden>
          ⠿
        </span>
        <span className="mono-label">{title}</span>
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
      {!min && (
        <span
          className="lab-win-resize"
          aria-hidden
          onPointerDown={(e) => desk.resize(e, id)}
          title="Resize: one or two columns wide, up to the content's height"
        />
      )}
    </section>
  );
}
