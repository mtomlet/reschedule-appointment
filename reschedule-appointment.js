const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const CONFIG = {
  AUTH_URL: 'https://d18devmarketplace.meevodev.com/oauth2/token',
  API_URL: 'https://d18devpub.meevodev.com/publicapi/v1',
  CLIENT_ID: 'a7139b22-775f-4938-8ecb-54aa23a1948d',
  CLIENT_SECRET: 'b566556f-e65d-47dd-a27d-dd1060d9fe2d',
  TENANT_ID: '4',
  LOCATION_ID: '5'
};

let token = null;
let tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry - 300000) return token;

  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });

  token = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return token;
}

app.post('/reschedule', async (req, res) => {
  try {
    const { phone, email, new_datetime, appointment_service_id, service_id, client_id, stylist_id, concurrency_check } = req.body;

    if (!new_datetime) {
      return res.json({
        success: false,
        error: 'Please provide new_datetime for rescheduled appointment'
      });
    }

    if (!appointment_service_id && !phone && !email) {
      return res.json({
        success: false,
        error: 'Please provide appointment_service_id or phone/email to lookup'
      });
    }

    const authToken = await getToken();

    let serviceIdToReschedule = appointment_service_id;
    let serviceId = service_id;
    let clientId = client_id;
    let stylistId = stylist_id;
    let concurrencyDigits = concurrency_check;

    // If phone/email provided, lookup the appointment
    if (!serviceIdToReschedule) {
      // Step 1: Find client
      const clientsRes = await axios.get(
        `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
        { headers: { Authorization: `Bearer ${authToken}` }}
      );

      const clients = clientsRes.data.data || clientsRes.data;
      const client = clients.find(c => {
        if (phone) {
          const cleanPhone = phone.replace(/\D/g, '');
          const clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '');
          return clientPhone === cleanPhone;
        }
        if (email) {
          return c.emailAddress?.toLowerCase() === email.toLowerCase();
        }
        return false;
      });

      if (!client) {
        return res.json({
          success: false,
          error: 'No client found with that phone number or email'
        });
      }

      clientId = client.clientId;

      // Step 2: Get next upcoming appointment
      const appointmentsRes = await axios.get(
        `${CONFIG.API_URL}/book/client/${client.clientId}/services?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
        { headers: { Authorization: `Bearer ${authToken}` }}
      );

      const allAppointments = appointmentsRes.data.data || appointmentsRes.data;
      const now = new Date();
      const upcomingAppointments = allAppointments
        .filter(apt => new Date(apt.startTime) > now && !apt.isCancelled)
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      if (upcomingAppointments.length === 0) {
        return res.json({
          success: false,
          error: 'No upcoming appointments found'
        });
      }

      const nextAppt = upcomingAppointments[0];
      serviceIdToReschedule = nextAppt.appointmentServiceId;
      serviceId = nextAppt.serviceId;
      stylistId = nextAppt.employeeId;
      concurrencyDigits = nextAppt.concurrencyCheckDigits;

      console.log('Found appointment to reschedule:', serviceIdToReschedule, 'from', nextAppt.startTime, 'to', new_datetime);
    }

    // Step 3: Reschedule the appointment via PUT
    const rescheduleData = new URLSearchParams({
      ServiceId: serviceId,
      StartTime: new_datetime,
      ClientId: clientId,
      ClientGender: 2035,
      ConcurrencyCheckDigits: concurrencyDigits
    });

    if (stylistId) rescheduleData.append('EmployeeId', stylistId);

    const rescheduleRes = await axios.put(
      `${CONFIG.API_URL}/book/service/${serviceIdToReschedule}?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
      rescheduleData.toString(),
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('Reschedule response:', rescheduleRes.data);

    res.json({
      success: true,
      rescheduled: true,
      new_datetime: new_datetime,
      message: 'Your appointment has been rescheduled',
      appointment_service_id: serviceIdToReschedule
    });

  } catch (error) {
    console.error('Reschedule error:', error.message);
    res.json({
      success: false,
      error: error.response?.data?.error?.message || error.message
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reschedule server running on port ${PORT}`));
