require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3001;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(bodyParser.json());

const sentOrders = new Set();

function getOrderSubject(status, orderId) {
  switch (status) {
    case 'Fulfilled':
      return `✅ Order #${orderId} Fulfilled`;
    case 'Awaiting Payment':
      return `💰 Payment Pending for Order #${orderId}`;
    case 'Delivered':
      return `📦 Order #${orderId} Delivered`;
    default:
      return `📋 Order #${orderId} Update`;
  }
}

function getOrderBody(data) {
  const lines = data.order_lines?.map((item) => {
    return `${item.order_qty}x ${item.item_name} @ $${item.unit_price} each = $${item.line_total_price}`;
  })?.join('\n') || 'No line items.';

  return `Customer: ${data.destination?.name || 'N/A'}\nStatus: ${data.order_status}\nPayment: ${data.payment_status}\nRequested Delivery: ${data.requested_delivery_date}\n\n${lines}`;
}

function shouldSendUpdate(data) {
  const validStatuses = ['Created', 'Fulfilled', 'Delivered', 'Awaiting Payment'];
  return validStatuses.includes(data.order_status) || validStatuses.includes(data.payment_status);
}

app.post('/webhook', (req, res) => {
  const body = req.body;
  console.log('Webhook received:', body);

  if (body.resource_type !== 'order' || !body.data || !body.data.id) {
    console.log('❌ Missing or invalid order data');
    return res.status(400).send('Invalid data');
  }

  const orderId = body.data.id;
  const statusKey = `${orderId}-${body.data.order_status}-${body.data.payment_status}`;

  if (!shouldSendUpdate(body.data)) {
    console.log(`⚠️ Skipping status: ${body.data.order_status}, payment: ${body.data.payment_status}`);
    return res.status(200).send('Skipped');
  }

  if (sentOrders.has(statusKey)) {
    console.log(`🔁 Duplicate update ignored for ${statusKey}`);
    return res.status(200).send('Duplicate ignored');
  }

  sentOrders.add(statusKey);

  const msg = {
    to: process.env.ALERT_EMAIL,
    from: process.env.ALERT_EMAIL,
    subject: getOrderSubject(body.data.order_status, orderId),
    text: getOrderBody(body.data),
  };

  sgMail
    .send(msg)
    .then(() => {
      console.log(`✅ Email sent for Order #${orderId}`);
    })
    .catch((error) => {
      console.error(`❌ Email failed for Order #${orderId}`, error);
    });

  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on http://localhost:${PORT}`);
});
