import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import type { Photo } from "@/lib/dumpdeck/types";

export function SortableGrid({
  photos,
  onChange,
  onRemove,
}: {
  photos: Photo[];
  onChange: (next: Photo[]) => void;
  onRemove?: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  function handleEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = photos.findIndex((p) => p.id === active.id);
    const newI = photos.findIndex((p) => p.id === over.id);
    if (oldI === -1 || newI === -1) return;
    onChange(arrayMove(photos, oldI, newI));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleEnd}>
      <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <SortableItem key={p.id} photo={p} slide={i + 1} onRemove={onRemove} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ photo, slide, onRemove }: { photo: Photo; slide: number; onRemove?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative overflow-hidden rounded-2xl bg-muted shadow-md ring-1 ring-ink/5 touch-none"
    >
      <div style={{ aspectRatio: "4 / 5" }}>
        <img src={photo.previewUrl ?? photo.url} alt="" decoding="async" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      </div>
      <div className="absolute left-1.5 top-1.5 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-bold text-white">
        {slide}
      </div>
      <div className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white/85 text-ink opacity-0 transition group-hover:opacity-100">
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(photo.id);
          }}
          className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-ink/75 text-cream shadow-lg"
          aria-label="Remove slide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
