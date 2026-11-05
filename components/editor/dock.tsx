'use client';

import type { Icon } from '@phosphor-icons/react';
import {
  ArrowUpRightIcon,
  CircleIcon,
  CursorIcon,
  EraserIcon,
  HandIcon,
  HighlighterIcon,
  ImageSquareIcon,
  LineSegmentIcon,
  PenNibIcon,
  SquareIcon,
  TextTIcon,
} from '@phosphor-icons/react';
import type { Engine, EngineState, Tool } from '@/lib/canvas/engine';
import { inkColor } from '@/lib/canvas/scene';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS, SHAPE_WIDTHS } from './palette';

const SHAPE_TOOLS: Array<{ tool: Tool; label: string; key: string; icon: Icon }> = [
  { tool: 'line', label: 'Line', key: 'L', icon: LineSegmentIcon },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: ArrowUpRightIcon },
  { tool: 'rectangle', label: 'Rectangle', key: 'R', icon: SquareIcon },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: CircleIcon },
];
const isShape = (t: Tool) => SHAPE_TOOLS.some((s) => s.tool === t);

function ToolButton({ label, shortcut, active, onClick, icon: IconC, dot }: { label: string; shortcut: string; active: boolean; onClick: () => void; icon: Icon; dot?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'pressable relative grid size-11 shrink-0 place-items-center rounded-full text-white/72 outline-offset-0 hover:text-white',
            active ? 'bg-white/[0.17] text-white' : '[@media(hover:hover)]:hover:bg-white/10',
          )}
        >
          <IconC className="size-[22px]" weight={active ? 'fill' : 'regular'} />
          {dot ? <span aria-hidden="true" className="absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full ring-1 ring-black/20" style={{ background: dot }} /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={10}>
        {label} <Kbd className="ml-1.5">{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function Dock({ engine, state, paper }: { engine: Engine; state: EngineState; paper: '#ffffff' | '#000000' }) {
  const t = state.tool;
  const shapeTool = isShape(t) ? SHAPE_TOOLS.find((s) => s.tool === t)! : SHAPE_TOOLS[2];
  const show = (c: string) => inkColor(c, paper);
  return (
    <div className="material-dock flex max-w-[calc(100vw-1.5rem)] items-center gap-0.5 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]" role="toolbar" aria-label="Tools">
      <ToolButton label="Select" shortcut="V" icon={CursorIcon} active={t === 'select'} onClick={() => engine.setTool('select')} />
      <span className="mx-1 h-6 w-px shrink-0 bg-white/12" aria-hidden="true" />
      <ToolButton label="Pen" shortcut="P" icon={PenNibIcon} active={t === 'pen'} onClick={() => engine.setTool('pen')} dot={show(state.pen.color)} />
      <ToolButton label="Highlighter" shortcut="M" icon={HighlighterIcon} active={t === 'highlighter'} onClick={() => engine.setTool('highlighter')} dot={state.highlighter.color} />
      <ToolButton label="Eraser" shortcut="E" icon={EraserIcon} active={t === 'eraser'} onClick={() => engine.setTool('eraser')} />
      <ToolButton label={shapeTool.label} shortcut={shapeTool.key} icon={shapeTool.icon} active={isShape(t)} onClick={() => engine.setTool(shapeTool.tool)} />
      <ToolButton label="Text" shortcut="T" icon={TextTIcon} active={t === 'text'} onClick={() => engine.setTool('text')} />
      <ToolButton label="Image" shortcut="I" icon={ImageSquareIcon} active={t === 'image'} onClick={() => engine.setTool('image')} />
      <span className="mx-1 h-6 w-px shrink-0 bg-white/12" aria-hidden="true" />
      <ToolButton label="Move the page" shortcut="H" icon={HandIcon} active={t === 'hand'} onClick={() => engine.setTool('hand')} />
    </div>
  );
}

function Swatch({ color, shown, name, active, onClick }: { color: string; shown: string; name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={active}
      onClick={onClick}
      title={name}
      className="pressable relative grid size-9 shrink-0 place-items-center rounded-full"
      data-color={color}
    >
      <span className="size-6 rounded-full ring-1 ring-white/25 transition-transform duration-150" style={{ background: shown, transform: active ? 'scale(0.78)' : undefined }} />
      {active ? <span aria-hidden="true" className="absolute inset-0.5 rounded-full ring-2 ring-white" /> : null}
    </button>
  );
}

/** Colour, width, and shape choices for the tool in hand. Rises out of the dock. */
export function InkTray({ engine, state, paper }: { engine: Engine; state: EngineState; paper: '#ffffff' | '#000000' }) {
  const t = state.tool;
  const kind = t === 'highlighter' ? 'highlighter' : isShape(t) ? 'shape' : t === 'pen' || t === 'text' ? 'pen' : null;
  const visible = kind !== null || (t === 'select' && state.selection.length > 0);
  const effective = kind ?? 'pen';
  const ink = state[effective];
  const colors = effective === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const widths = effective === 'highlighter' ? HIGHLIGHTER_WIDTHS : effective === 'shape' ? SHAPE_WIDTHS : PEN_WIDTHS;
  const maxW = widths[widths.length - 1];

  return (
    <div
      className={cn(
        'kbd-instant material-dock flex max-w-[calc(100vw-1.5rem)] origin-bottom items-center gap-1 overflow-x-auto rounded-full px-2 py-1.5 [scrollbar-width:none]',
        'transition-[opacity,transform,filter] ease-[var(--ease-out)]',
        visible ? 'scale-100 opacity-100 blur-0 duration-200' : 'pointer-events-none translate-y-2 scale-[0.96] opacity-0 blur-[2px] duration-120',
      )}
      aria-hidden={!visible}
      role="group"
      aria-label={t === 'select' ? 'Recolour selection' : 'Ink'}
    >
      {kind === 'shape'
        ? SHAPE_TOOLS.map((s) => (
            <button
              key={s.tool}
              type="button"
              aria-label={s.label}
              aria-pressed={t === s.tool}
              onClick={() => engine.setTool(s.tool)}
              className={cn('pressable grid size-9 shrink-0 place-items-center rounded-full text-white/75', t === s.tool ? 'bg-white/16 text-white' : 'hover:bg-white/10')}
            >
              <s.icon className="size-5" weight={t === s.tool ? 'bold' : 'regular'} />
            </button>
          ))
        : null}
      {kind === 'shape' ? <span className="mx-1 h-6 w-px shrink-0 bg-white/12" aria-hidden="true" /> : null}
      {colors.map((c) => (
        <Swatch
          key={c.value}
          name={c.value === '#000000' ? (paper === '#000000' ? 'Ink (white on dark paper)' : 'Ink') : c.name}
          color={c.value}
          shown={inkColor(c.value, paper)}
          active={ink.color.toLowerCase() === c.value}
          onClick={() => engine.setInk(effective, { color: c.value })}
        />
      ))}
      {kind ? (
        <>
          <span className="mx-1 h-6 w-px shrink-0 bg-white/12" aria-hidden="true" />
          {widths.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`Width ${w}`}
              aria-pressed={ink.width === w}
              onClick={() => engine.setInk(effective, { width: w })}
              className={cn('pressable grid size-9 shrink-0 place-items-center rounded-full', ink.width === w ? 'bg-white/16' : 'hover:bg-white/10')}
            >
              <span className="rounded-full bg-white" style={{ width: 4 + (w / maxW) * 14, height: 4 + (w / maxW) * 14, opacity: effective === 'highlighter' ? 0.75 : 1 }} />
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}

export { isShape };
