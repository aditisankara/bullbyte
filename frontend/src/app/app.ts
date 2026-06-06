import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DisclaimerFooterComponent } from './shared/disclaimer-footer/disclaimer-footer.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DisclaimerFooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
