import { TestBed } from '@angular/core/testing';
import {
  DisclaimerFooterComponent,
  DISCLAIMER_TEXT,
} from './disclaimer-footer.component';

describe('DisclaimerFooterComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DisclaimerFooterComponent],
    }).compileComponents();
  });

  it('renders the canonical disclaimer in a semantic <footer>', () => {
    const fixture = TestBed.createComponent(DisclaimerFooterComponent);
    fixture.detectChanges();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain(DISCLAIMER_TEXT);
  });

  it('uses the design-system canonical wording (via EDGAR)', () => {
    expect(DISCLAIMER_TEXT).toBe(
      'Not financial advice. Data sourced from public SEC filings via EDGAR.',
    );
  });
});
