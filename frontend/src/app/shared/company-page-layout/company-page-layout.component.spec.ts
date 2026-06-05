import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CompanyPageLayoutComponent } from './company-page-layout.component';

@Component({
  standalone: true,
  imports: [CompanyPageLayoutComponent],
  template: `
    <app-company-page-layout>
      <div score class="t-score">SCORE</div>
      <div timeline class="t-timeline">TIMELINE</div>
      <div claims class="t-claims">CLAIMS</div>
      <div detail class="t-detail">DETAIL</div>
    </app-company-page-layout>
  `,
})
class HostComponent {}

describe('CompanyPageLayoutComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('projects all four named slots into their regions', () => {
    const el = render();
    expect(el.querySelector('.layout__score .t-score')?.textContent).toBe('SCORE');
    expect(el.querySelector('.layout__timeline .t-timeline')?.textContent).toBe('TIMELINE');
    expect(el.querySelector('.layout__claims .t-claims')?.textContent).toBe('CLAIMS');
    expect(el.querySelector('.layout__detail .t-detail')?.textContent).toBe('DETAIL');
  });

  it('places claims and detail inside the body row', () => {
    const el = render();
    const body = el.querySelector('.layout__body');
    expect(body?.querySelector('.layout__claims')).not.toBeNull();
    expect(body?.querySelector('.layout__detail')).not.toBeNull();
  });

  it('renders detail as a semantic aside (rail)', () => {
    const el = render();
    expect(el.querySelector('aside.layout__detail')).not.toBeNull();
  });
});
