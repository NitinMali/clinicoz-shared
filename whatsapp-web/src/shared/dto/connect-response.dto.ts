import { ConnectionStatus } from '../../whatsapp/whatsapp.interfaces';

export interface ConnectResponse {
  customerId: string;
  status: ConnectionStatus;
  message?: string;
}

export interface QrResponse {
  customerId: string;
  status: ConnectionStatus;
  qrCode: string | null;
  qrImage: string | null;
  message?: string;
}

export interface StatusResponse {
  customerId: string;
  status: ConnectionStatus;
}
