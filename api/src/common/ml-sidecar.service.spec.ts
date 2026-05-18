import { MlSidecarService } from './ml-sidecar.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('MlSidecarService', () => {
  let service: MlSidecarService;
  let mockHttpService: { get: jest.Mock };
  let mockConfigService: { getOrThrow: jest.Mock };

  beforeEach(() => {
    mockHttpService = { get: jest.fn().mockReturnValue(of({ data: { status: 'ok', service: 'ml' } })) };
    mockConfigService = { getOrThrow: jest.fn().mockReturnValue('http://ml-sidecar:8000') };
    service = new MlSidecarService(mockHttpService as any, mockConfigService as any);
  });

  it('reads ML_SIDECAR_URL from config via getOrThrow', () => {
    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('ML_SIDECAR_URL');
  });

  it('calls HttpService.get with the correct sidecar health URL', () => {
    service.getHealth().subscribe();
    expect(mockHttpService.get).toHaveBeenCalledWith('http://ml-sidecar:8000/health');
  });

  it('returns observable from HttpService.get', (done) => {
    service.getHealth().subscribe((res) => {
      expect(res.data).toEqual({ status: 'ok', service: 'ml' });
      done();
    });
  });

  it('maps sidecar errors to ServiceUnavailableException', (done) => {
    mockHttpService.get.mockReturnValue(throwError(() => new Error('connection refused')));
    service.getHealth().subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        expect(err.getStatus()).toBe(503);
        done();
      },
    });
  });
});
