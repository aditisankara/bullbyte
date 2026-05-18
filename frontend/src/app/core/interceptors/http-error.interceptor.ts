import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

export interface ApiError {
  status: number;
  message: string;
}

export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      let message: string;
      if (error.status === 0) {
        message = 'Unable to reach the server. Please check your connection.';
      } else if (error.status >= 500) {
        message = 'A server error occurred. Please try again later.';
      } else {
        message = 'The request could not be completed.';
      }

      return throwError(() => ({ status: error.status, message } satisfies ApiError));
    }),
  );
};
