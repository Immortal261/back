// Оплата через постоянную ссылку Kaspi Pay.
// Логика по вашему решению: ссылка ОДНА и та же для всех заказов (берётся
// из .env), клиент сам вводит точную сумму заказа в приложении Kaspi —
// никакой генерации ссылки/QR на сумму через API не требуется.
//
// Если позже подключите реальный Kaspi Business API с уникальной ссылкой
// на каждый заказ — замените логику ниже, интерфейс функции (что она
// возвращает) менять не обязательно: order-service.js и фронтенд уже умеют
// работать с полем paymentUrl.

const paymentUrl = process.env.KASPI_PAYMENT_LINK || null;

/**
 * @param {{ id: string, totalTenge: number, contact: object }} order
 */
async function createKaspiPayment(order) {
  const sum = order.totalTenge.toLocaleString("ru-RU");

  if (!paymentUrl) {
    // Ссылка ещё не настроена в .env — тот же честный демо-режим, что и раньше.
    return {
      mode: "demo",
      status: "awaiting_manual_invoice",
      paymentUrl: null,
      instructions:
        `Ссылка на оплату Kaspi Pay не настроена (KASPI_PAYMENT_LINK в .env пуст). ` +
        `Свяжитесь с клиентом (${order.contact.phone}) и отправьте счёт на сумму ${sum} ₸ вручную через Kaspi.kz.`,
    };
  }

  return {
    mode: "link",
    status: "awaiting_payment_via_link",
    paymentUrl,
    instructions:
      `Оплатите точную сумму ${sum} ₸ по ссылке Kaspi Pay — сумму нужно ввести вручную, ` +
      `ссылка одна и та же для всех заказов и сама сумму не подставляет.`,
  };
}

module.exports = { createKaspiPayment };
