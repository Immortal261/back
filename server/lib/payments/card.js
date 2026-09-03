// Приём оплаты банковской картой в Казахстане обычно делают через
// эквайринг/агрегатор — например Epay (Halyk Bank), CloudPayments,
// PayBox, Freedom Pay и т.п. У каждого свой контракт API (создание
// платежа, редирект на страницу оплаты, webhook о результате).
//
// Здесь — такая же честная заглушка, как и для Kaspi: пока в .env
// нет CARD_PROVIDER/CARD_API_KEY/CARD_API_SECRET, сайт работает
// в демо-режиме и не пытается изобразить работу несуществующего API.

const hasRealCredentials = () =>
  Boolean(process.env.CARD_PROVIDER && process.env.CARD_API_KEY);

/**
 * @param {{ id: string, totalTenge: number, contact: object }} order
 */
async function createCardPayment(order) {
  if (!hasRealCredentials()) {
    return {
      mode: "demo",
      status: "awaiting_provider_setup",
      paymentUrl: null,
      instructions:
        "Демо-режим оплаты картой: подключите агрегатора (Epay/CloudPayments/PayBox и т.п.), " +
        "впишите CARD_PROVIDER и ключи в .env, и замените вызов в server/lib/payments/card.js " +
        "на реальный запрос создания платежа этого провайдера.",
    };
  }

  // --- ТОЧКА РЕАЛЬНОЙ ИНТЕГРАЦИИ ---
  // switch (process.env.CARD_PROVIDER) {
  //   case "epay": /* вызов Epay API */ break;
  //   case "cloudpayments": /* вызов CloudPayments API */ break;
  //   default: throw new Error("Неизвестный CARD_PROVIDER");
  // }

  return {
    mode: "live",
    status: "pending_provider_call",
    paymentUrl: null,
    instructions:
      "Ключи заполнены в .env, но вызов реального провайдера карточных платежей " +
      "нужно дописать в server/lib/payments/card.js.",
  };
}

module.exports = { createCardPayment, hasRealCredentials };
