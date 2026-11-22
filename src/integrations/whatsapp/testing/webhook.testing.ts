export function webhookPayload(
  value: { messages?: unknown[]; statuses?: unknown[] },
  phoneNumberId = '1122334455',
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5586000000000', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Cliente Teste' }, wa_id: '5586999991234' }],
              ...value,
            },
          },
        ],
      },
    ],
  };
}

export function textWebhook(text: string, id = 'wamid.IN', from = '5586999991234') {
  return webhookPayload({
    messages: [{ from, id, timestamp: '1760000000', type: 'text', text: { body: text } }],
  });
}
