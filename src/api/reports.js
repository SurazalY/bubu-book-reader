import { createApiClient } from './client.js'

export function createReportsApi(client = createApiClient()) {
  return {
    listStudents: (options = {}) => client.get('/students', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    listReports: (options = {}) => client.get('/reports', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    listParentContacts: (options = {}) => client.get('/parent-contacts', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    listDeliveries: (options = {}) => client.get('/deliveries', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    createReport: (body, options = {}) => client.post('/reports', { ...options, body }),
    reviewReport: (reportId, versionId, options = {}) =>
      client.post(`/reports/${encodeURIComponent(reportId)}/review`, { ...options, body: { versionId } }),
    createParentContact: (body, options = {}) => client.post('/parent-contacts', { ...options, body }),
    createDelivery: (reportId, body, options = {}) =>
      client.post(`/reports/${encodeURIComponent(reportId)}/deliveries`, { ...options, body }),
    processDelivery: (deliveryId, options = {}) =>
      client.post(`/deliveries/${encodeURIComponent(deliveryId)}/process`, { ...options, body: {} }),
    getDelivery: (deliveryId, options = {}) => client.get(`/deliveries/${encodeURIComponent(deliveryId)}`, options),
  }
}
