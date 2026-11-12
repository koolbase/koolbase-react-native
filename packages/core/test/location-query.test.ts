import { KbField, KbSort } from '../src/query-builder';

// G5: a location field's within and the nearest-first sort, exactly the JSON
// the API parses and koolbase_flutter sends.
describe('location queries', () => {
  it('within: the point and the distance', () => {
    expect(KbField('place').within(5.6037, -0.187, 25)).toEqual({
      field: 'place',
      operator: 'within',
      value: { kind: 'literal', value: { lat: 5.6037, lng: -0.187, km: 25 } },
    });
  });

  it('near: nearest first from the point', () => {
    expect(KbSort.near('place', 5.6, -0.18)).toEqual({ field: 'place', dir: 'asc', near: { lat: 5.6, lng: -0.18 } });
    expect(KbSort.asc('title')).toEqual({ field: 'title', dir: 'asc' });
  });

  it('a point off the Earth, or no distance, is refused here', () => {
    expect(() => KbField('place').within(91, 0, 5)).toThrow(RangeError);
    expect(() => KbField('place').within(0, 181, 5)).toThrow(RangeError);
    expect(() => KbField('place').within(0, 0, 0)).toThrow(RangeError);
    expect(() => KbSort.near('place', -91, 0)).toThrow(RangeError);
  });
});
