export const PRODUCT_QUANTITY_MODES = ['unit', 'measure'] as const;
export type ProductQuantityMode = typeof PRODUCT_QUANTITY_MODES[number];

export const PRODUCT_MEASUREMENT_UNITS = ['unidad', 'kg', 'g', 'l', 'ml', 'm'] as const;
export type ProductMeasurementUnit = typeof PRODUCT_MEASUREMENT_UNITS[number];

export type MeasurableProduct = {
  quantity_mode?: ProductQuantityMode | string | null;
  measurement_unit?: ProductMeasurementUnit | string | null;
  price_reference_quantity?: number | string | null;
  sale_price?: number | string | null;
  cost?: number | string | null;
};

const unitLabels: Record<ProductMeasurementUnit, { singular: string; plural: string; short: string }> = {
  unidad: { singular: 'unidad', plural: 'unidades', short: 'u.' },
  kg: { singular: 'kg', plural: 'kg', short: 'kg' },
  g: { singular: 'g', plural: 'g', short: 'g' },
  l: { singular: 'litro', plural: 'litros', short: 'l' },
  ml: { singular: 'ml', plural: 'ml', short: 'ml' },
  m: { singular: 'metro', plural: 'metros', short: 'm' },
};

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'string'
    ? Number(value.trim().replace(',', '.'))
    : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeProductQuantityMode = (value: unknown): ProductQuantityMode =>
  value === 'measure' ? 'measure' : 'unit';

export const normalizeProductMeasurementUnit = (value: unknown): ProductMeasurementUnit =>
  PRODUCT_MEASUREMENT_UNITS.includes(value as ProductMeasurementUnit)
    ? value as ProductMeasurementUnit
    : 'unidad';

export const getProductQuantityMode = (product: MeasurableProduct): ProductQuantityMode =>
  normalizeProductQuantityMode(product?.quantity_mode);

export const isMeasuredProduct = (product: MeasurableProduct) =>
  getProductQuantityMode(product) === 'measure';

export const getProductMeasurementUnit = (product: MeasurableProduct): ProductMeasurementUnit =>
  isMeasuredProduct(product)
    ? normalizeProductMeasurementUnit(product?.measurement_unit)
    : 'unidad';

export const getProductPriceReferenceQuantity = (product: MeasurableProduct) => {
  if (!isMeasuredProduct(product)) return 1;
  const value = toFiniteNumber(product?.price_reference_quantity, 1);
  return value > 0 ? value : 1;
};

export const roundMeasurementQuantity = (value: unknown, decimals = 6) => {
  const quantity = toFiniteNumber(value);
  const factor = 10 ** decimals;
  return Math.round((quantity + Number.EPSILON) * factor) / factor;
};

export const parseLocalizedDecimal = (value: unknown) => roundMeasurementQuantity(value);

export const getProductSaleUnitPrice = (product: MeasurableProduct) =>
  roundMeasurementQuantity(
    toFiniteNumber(product?.sale_price) / getProductPriceReferenceQuantity(product)
  );

export const getProductCostUnitPrice = (product: MeasurableProduct) =>
  roundMeasurementQuantity(
    toFiniteNumber(product?.cost) / getProductPriceReferenceQuantity(product)
  );

export const getProductQuantityStep = (product: MeasurableProduct) =>
  isMeasuredProduct(product) ? 0.001 : 1;

export const normalizeProductQuantity = (product: MeasurableProduct, value: unknown) => {
  const quantity = roundMeasurementQuantity(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return isMeasuredProduct(product) ? quantity : Math.floor(quantity);
};

export const isValidProductQuantity = (product: MeasurableProduct, value: unknown) => {
  const quantity = roundMeasurementQuantity(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  return isMeasuredProduct(product) || Number.isInteger(quantity);
};

export const formatMeasurementQuantity = (
  value: unknown,
  unit: ProductMeasurementUnit | string | null | undefined = 'unidad',
  options: { includeUnit?: boolean; maximumFractionDigits?: number } = {}
) => {
  const quantity = roundMeasurementQuantity(value);
  const normalizedUnit = normalizeProductMeasurementUnit(unit);
  const formatted = quantity.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 6,
  });

  if (!options.includeUnit || normalizedUnit === 'unidad') return formatted;
  return `${formatted} ${unitLabels[normalizedUnit].short}`;
};

export const formatProductQuantity = (
  product: MeasurableProduct,
  value: unknown,
  includeUnit = true
) => formatMeasurementQuantity(value, getProductMeasurementUnit(product), {
  includeUnit: includeUnit && isMeasuredProduct(product),
});

export const getMeasurementUnitLabel = (
  unit: ProductMeasurementUnit | string | null | undefined,
  quantity = 1
) => {
  const normalizedUnit = normalizeProductMeasurementUnit(unit);
  return Math.abs(quantity) === 1
    ? unitLabels[normalizedUnit].singular
    : unitLabels[normalizedUnit].plural;
};

export const getMeasurementUnitShortLabel = (unit: ProductMeasurementUnit | string | null | undefined) =>
  unitLabels[normalizeProductMeasurementUnit(unit)].short;

export const getProductPresentationLabel = (product: MeasurableProduct) => {
  if (!isMeasuredProduct(product)) return 'por unidad';
  const reference = getProductPriceReferenceQuantity(product);
  return `por ${formatMeasurementQuantity(reference)} ${getMeasurementUnitShortLabel(getProductMeasurementUnit(product))}`;
};
