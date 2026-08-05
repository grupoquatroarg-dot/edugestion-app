import { AppError } from './response.js';

const toNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const normalizeSaleFreightPercentage = (value: unknown, actorRole: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  const percentage = Number(value);

  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new AppError('El porcentaje de flete debe estar entre 0 y 100', 400);
  }
  if (percentage > 0 && String(actorRole || '').toLowerCase() !== 'administrador') {
    throw new AppError('Solo un administrador puede aplicar flete a una venta', 403);
  }

  return percentage;
};

export const calculateSalePricesWithFreight = (params: {
  originalPrice: unknown;
  discountType: unknown;
  discountValue: unknown;
  freightPercentage: number;
}) => {
  const originalPrice = Math.max(0, toNumber(params.originalPrice));
  const discountType = String(params.discountType || 'none');
  const discountValue = Math.max(0, toNumber(params.discountValue));
  let discountedPrice = originalPrice;

  if (discountType === 'percentage') {
    discountedPrice = originalPrice * (1 - Math.min(discountValue, 100) / 100);
  } else if (discountType === 'fixed') {
    discountedPrice = Math.max(0, originalPrice - discountValue);
  }

  const multiplier = 1 + params.freightPercentage / 100;
  return {
    originalPrice: roundMoney(originalPrice * multiplier),
    discountedPrice: roundMoney(discountedPrice * multiplier),
    discountValue: discountType === 'fixed'
      ? roundMoney(discountValue * multiplier)
      : discountValue,
  };
};
