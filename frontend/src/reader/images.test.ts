import { tappedImage } from './images';

describe('the tapped picture', () => {
  it('is an <img> or an SVG <image>, also when the tap lands on something inside it', () => {
    document.body.innerHTML = `<p>Text <a href="#x"><img src="blob:fig1" alt="Figure 1"></a></p>
      <svg><image href="blob:cover" aria-label="Cover"/></svg><p id="plain">No picture</p>`;
    expect(tappedImage(document.querySelector('img'))).toEqual({ src: 'blob:fig1', alt: 'Figure 1' });
    expect(tappedImage(document.querySelector('image'))).toEqual({ src: 'blob:cover', alt: 'Cover' });
    expect(tappedImage(document.getElementById('plain'))).toBeNull();
    expect(tappedImage(null)).toBeNull();
  });
});
