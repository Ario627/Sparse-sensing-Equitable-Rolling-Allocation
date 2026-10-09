export const SENSOR_ENTITY = 'Sensor';
export const SENSOR_CREATE_AUDIT_ACTION = 'sensor.create';
export const SENSOR_UPDATE_AUDIT_ACTION = 'sensor.update';
export const SENSOR_CALIBRATE_AUDIT_ACTION = 'sensor.calibrate';

export const SENSOR_MESSAGES = {
  notFound: 'Sensor not found',
  networkNotFound: 'Network not found',
  nodeNotFound: 'Node not found',
  nodeNetworkMismatch: 'Node does not belong to the sensor network',
  duplicateId: 'Sensor id is already registered',
} as const;
