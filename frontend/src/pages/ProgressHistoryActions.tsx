import { Ellipsis, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import "./ProgressHistoryActions.css";

export function HistoryActions({ label, onDelete }: {
  label: string;
  onDelete: (trigger: HTMLButtonElement) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !actions.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      ref={actions}
      className="history-actions"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="history-actions-trigger"
        aria-label={`${label} · 更多`}
        title="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (open) item.current?.focus();
          else setOpen(true);
        }}
      >
        <Ellipsis size={21} aria-hidden="true" />
      </button>
      {open && (
        <div className="history-actions-menu" id={id} role="menu" aria-label={`${label} · 练习操作`}>
          <button
            type="button"
            ref={item}
            role="menuitem"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault();
            }}
            onClick={() => {
              setOpen(false);
              if (trigger.current) onDelete(trigger.current);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            删除这次练习
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoryDeleteDialog({ title, kind, createdAt, date, pending, error, onCancel, onConfirm }: {
  title: string;
  kind: string;
  createdAt: string;
  date: string;
  pending: boolean;
  error: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="history-delete-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-record ${id}-impact`}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
    >
      <div className="history-delete-icon"><Trash2 size={21} aria-hidden="true" /></div>
      <h2 id={`${id}-title`}>删除这次练习？</h2>
      <div className="history-delete-record" id={`${id}-record`}>
        <strong>{title}</strong>
        <span>{kind} · <time dateTime={createdAt}>{date}</time></span>
      </div>
      <p className="history-delete-copy" id={`${id}-impact`}>
        删除后无法回看，这次记录也会从练习统计中移除。独立收藏的表达和已获得的奖励会保留。
      </p>
      {error && <p className="history-delete-error" role="alert">暂时无法删除，请重试。</p>}
      <div className="history-delete-buttons">
        <button type="button" ref={cancel} className="ui-secondary" aria-disabled={pending} onClick={onCancel}>取消</button>
        <button type="button" className="ui-button" aria-disabled={pending} onClick={onConfirm}>确认删除</button>
      </div>
      <p className="history-delete-pending" role="status">{pending ? "正在删除…" : ""}</p>
    </dialog>
  );
}
