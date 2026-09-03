import type { Product, Variant } from "@shared/types";

interface Props {
  product: Product;
  selected: Variant | undefined;
  onSelect: (variantId: string) => void;
  flashVariantId?: string;   // set for ~1.4 s when an AGENT selected a variant
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Variant the picker would land on when the human clicks `value` for option `name`: keep the other selected options, swap this one. */
export function variantFor(product: Product, selected: Variant | undefined, name: string, value: string): Variant | undefined {
  const want = { ...(selected?.options ?? {}), [name]: value };
  const exact = product.variants.find(v => Object.entries(want).every(([k, val]) => Object.entries(v.options).some(([vk, vv]) => eq(vk, k) && eq(vv, val))));
  if (exact) return exact;
  return product.variants.find(v => Object.entries(v.options).some(([vk, vv]) => eq(vk, name) && eq(vv, value)));
}

export function VariantPicker({ product, selected, onSelect, flashVariantId }: Props) {
  const groups = product.options.filter(o => o.values.length > 0);
  if (groups.length === 0 || product.variants.length <= 1) return null;
  return (
    <div className="variant-picker" data-testid="variant-picker">
      {groups.map(group => {
        const current = selected ? Object.entries(selected.options).find(([k]) => eq(k, group.name))?.[1] : undefined;
        return (
          <div className="variant-group" key={group.name}>
            <div className="variant-group-name">{group.name}: <b>{current ?? "—"}</b></div>
            <div className="chips" role="radiogroup" aria-label={group.name}>
              {group.values.map(value => {
                const target = variantFor(product, selected, group.name, value);
                const isSelected = current !== undefined && eq(current, value);
                const unavailable = !target || target.available === false;
                const flash = !!flashVariantId && !!target && target.id === flashVariantId && isSelected;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`variant-option-${group.name}-${value}`}
                    data-variant-id={target?.id ?? ""}
                    className={`chip${isSelected ? " selected" : ""}${unavailable ? " unavailable" : ""}${flash ? " agent-flash" : ""}`}
                    title={unavailable ? `${value} — out of stock` : value}
                    disabled={!target}
                    onClick={() => target && onSelect(target.id)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
