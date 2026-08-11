export function nextSort(current, key) {
  if (current.key !== key) return { key, direction: "desc" };
  if (current.direction === "desc") return { key, direction: "asc" };
  return { key: null, direction: null };
}

export function isRequestOlderThanSevenDays(request) {
  const createdAt = new Date(request.createdAt).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt > 7 * 24 * 60 * 60 * 1000;
}

export function sortTableRows(rows, sort, accessors, language) {
  if (!sort.key || !accessors[sort.key]) return rows;
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
  const accessor = accessors[sort.key];
  const direction = sort.direction === "desc" ? -1 : 1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = accessor(a.row);
      const right = accessor(b.row);
      let result;
      if (typeof left === "number" && typeof right === "number") result = left - right;
      else result = collator.compare(String(left ?? ""), String(right ?? ""));
      return result === 0 ? a.index - b.index : result * direction;
    })
    .map(({ row }) => row);
}

export default function SortableTableHeader({ columnKey, label, sort, onSort }) {
  const active = sort.key === columnKey;
  const ariaSort = active ? (sort.direction === "desc" ? "descending" : "ascending") : "none";
  return (
    <th aria-sort={ariaSort}>
      <button className={`table-sort-button${active ? " active" : ""}`} type="button" onClick={() => onSort(columnKey)}>
        <span>{label}</span>
        <span className="table-sort-indicator" aria-hidden="true">
          {active ? (sort.direction === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
  );
}
