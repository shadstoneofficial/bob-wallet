import React, { Component } from 'react';
import {connect, Provider} from 'react-redux';
import { ConnectedRouter } from '@rithvikvibhu/connected-react-router';
import App from './App';
import {I18nContext, translateLocale} from "../utils/i18n";

export default class Root extends Component {

  render() {
    // eslint-disable-next-line react/prop-types
    const { store, history } = this.props;

    return (
      <Provider store={store}>
        <Content history={history} />
      </Provider>
    );
  }
}

@connect(
  (state) => ({
    locale: state.app.locale,
    customLocale: state.app.customLocale,
    theme: state.app.theme,
  }),
)
class Content extends Component {
  componentDidMount() {
    this.applyThemeClass();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.theme !== this.props.theme) {
      this.applyThemeClass();
    }
  }

  applyThemeClass() {
    document.body.classList.toggle('bob-theme-dark', this.props.theme === 'dark');
  }

  translate = (key, ...values) => translateLocale(
    this.props.locale, this.props.customLocale, key, ...values,
  );

  render() {
    return (
      <I18nContext.Provider
        value={{
          t: this.translate,
          locale: this.props.locale,
        }}
      >
        <ConnectedRouter history={this.props.history}>
          <App />
        </ConnectedRouter>
      </I18nContext.Provider>
    );
  }
}
