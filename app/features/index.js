import featuresSpec from './features_spec';

const FT_OVERRIDE_PARAM = 'ft_ovr';
const FT_OVERRIDE_SPLIT_CHAR = '|';
const FT_OVERRIDE_VALUE_CHAR = '$';

let overrides = {};

// you can override by ft_ovr query string param:
// e.g. ?ft_ovr=submission>true|voting>false
export function parseFeatureOverridesFromQuery(params) {
  if (params && params[FT_OVERRIDE_PARAM]) {
    let overrides = params[FT_OVERRIDE_PARAM].split(FT_OVERRIDE_SPLIT_CHAR);

    let res = {};
    overrides.forEach(ovr => {
      let split = ovr.split(FT_OVERRIDE_VALUE_CHAR);
      let key = split[0] || '';
      let value = split[1] || 'false';

      if (key.trim() !== '') {
        res[key] = value === 'true';
      }
    });

    return res;
  }

  return {};
}

export function setFeatureOverrides(newOverrides) {
  overrides = newOverrides;
}

export default function getFeatureValue(name, defaultValue) {
  if (featuresSpec[name] !== undefined &&
    overrides[name] !== undefined) {
    return overrides[name];
  } else if (featuresSpec[name] !== undefined) {
    return featuresSpec[name];
  }

  return defaultValue;
}

export function canUseDom() {
  return typeof window !== 'undefined' && window.document && window.document.createElement;
}

export function canUseLocalStorage() {
  return typeof window !== 'undefined' && window.localStorage;
}
