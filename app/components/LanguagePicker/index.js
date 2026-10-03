import React, {useContext, useState} from 'react';
import {connect} from 'react-redux';
import Dropdown from '../Dropdown';
import {I18nContext, languageDropdownItems, predefinedLanguageItems, normalizeLocale} from '../../utils/i18n';
import {setLocale} from '../../ducks/app';

export function LanguagePicker({locale, setLocale}) {
  const {t} = useContext(I18nContext);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const title = t('settingLanguageTitle');
  const current = locale === 'custom' ? locale : normalizeLocale(locale);
  const items = locale === 'custom'
    ? [...predefinedLanguageItems, {...languageDropdownItems.find(item => item.value === 'custom'), disabled: true}]
    : predefinedLanguageItems;
  const change = async value => {
    setSaving(true);
    setError(false);
    try { await setLocale(value); }
    catch (_) { setError(true); }
    finally { setSaving(false); }
  };
  return <div className="app__language-picker">
    <Dropdown reversed items={items} currentIndex={items.findIndex(item => item.value === current)}
      accessibleLabel={title === 'Language' ? title : `${title} / Language`} disabled={saving} onChange={change} />
    {error && <span className="app__language-error" role="alert">{t('headerLanguageSaveError')}</span>}
  </div>;
}
export default connect(state => ({locale: state.app.locale}), {setLocale})(LanguagePicker);
