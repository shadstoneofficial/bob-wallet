import React, { Component } from 'react';
import c from 'classnames';
import './notification.scss';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { clear } from '../../ducks/notifications'

@connect(
  (state) => ({
    message: state.notifications.message,
    type: state.notifications.type,
    explorer: state.node.explorer,
  }),
  (dispatch) => ({
    clear: () => dispatch(clear())
  })
)
export default class Notification extends Component {
  static propTypes = {
    message: PropTypes.string.isRequired,
    type: PropTypes.oneOf([
      'success',
      'error'
    ]).isRequired,
    explorer: PropTypes.object.isRequired
  };

  el = null;

  componentDidUpdate() {
    if (!this.el) {
      return;
    }

    if (!this.props.message) {
      return;
    }

    setTimeout(() => (this.el.style.transform = 'translateY(60px)'), 0);
    this.timeout = setTimeout(this.clear, 7000);
  }

  clear = () => {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    if (this.el && this.el.style) {
      this.el.style.transform = 'translateY(calc(-100% - 8px))';
      this.timeout = setTimeout(() => this.props.clear(), 150);
    }
  };

  render() {
    if (!this.props.message) {
      return null;
    }

    const name = c('notification', `notification--${this.props.type}`);

    return (
      <div className={name} ref={(ref) => (this.el = ref)}>
        <div className="notification__close" onClick={this.clear}/>
        {this.renderMessage()}
        {this.renderCreateIssue()}
      </div>
    );
  }

  renderMessage() {
    const { message, explorer } = this.props;
    const match = String(message).match(/[a-f0-9]{64}/i);

    if (!match || !explorer || !explorer.tx) {
      return message;
    }

    const hash = match[0];
    const before = message.slice(0, match.index);
    const after = message.slice(match.index + hash.length);
    const url = explorer.tx.replace('%s', hash);

    return (
      <span>
        {before}
        <button
          className="notification__tx-link"
          type="button"
          onClick={() => require("electron").shell.openExternal(url)}
          title={url}
        >
          {hash}
        </button>
        {after}
      </span>
    );
  }

  renderCreateIssue() {
    const { type } = this.props;

    if (type !== 'error') {
      return null;
    }

    return (
      <div className="notification__issue-wrapper">
        <div className="notification__issue-wrapper__title">
          Oops! Would you mind telling us what went wrong?
        </div>
        <div
          className="notification__issue-wrapper__action"
          onClick={() => {
            const pkg = require('../../../package.json');
            require("electron").shell.openExternal(pkg.bugs.url);
          }}
        >
          Create Bug Report
        </div>
      </div>
    )
  }
}
