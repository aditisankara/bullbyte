import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () =>
      import('./features/search/search.routes').then((m) => m.SEARCH_ROUTES),
  },
  {
    path: 'company/:ticker',
    loadChildren: () =>
      import('./features/company/company.routes').then((m) => m.COMPANY_ROUTES),
  },
  {
    path: '**',
    redirectTo: '/',
  },
];
