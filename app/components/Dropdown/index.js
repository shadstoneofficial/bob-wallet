import React, { Component } from 'react';
import PropTypes from 'prop-types';
import c from 'classnames';
import './index.scss';

export default class Dropdown extends Component {
  static propTypes = {
    items: PropTypes.arrayOf(
      PropTypes.shape({
        label: PropTypes.string.isRequired,
        disabled: PropTypes.bool,
      }),
    ).isRequired,
    className: PropTypes.string,
    currentIndex: PropTypes.number,
    onChange: PropTypes.func,
    reversed: PropTypes.bool,
    accessibleLabel: PropTypes.string,
    disabled: PropTypes.bool,
  };

  static defaultProps = {
    currentIndex: 0,
    onChange() {},
    className: '',
  };

  state = {
    isOpen: false,
  };

  toggle = () => this.setState({ isOpen: !this.state.isOpen });

  select(i) {
    this.setState({ isOpen: false });
    this.props.onChange(i);
  }

  render() {
    const { items, currentIndex, className } = this.props;
    const { label: currentLabel } = items[currentIndex] || {};

    // Opt-in native control retains the shared value/index callback contract and
    // visual classes while providing platform keyboard, focus and screen-reader behavior.
    if (this.props.accessibleLabel) {
      return <div className={c('dropdown', 'dropdown--native', className, {
        'dropdown--reversed': this.props.reversed,
      })}>
        <div className="dropdown__current-item">
          <select aria-label={this.props.accessibleLabel} disabled={this.props.disabled}
            value={currentIndex} onChange={event => {
              const index = Number(event.target.value);
              const item = items[index];
              if (item && !item.disabled) this.props.onChange(item.value || index);
            }}>
            {items.map((item, index) => <option key={item.value || index}
              value={index} disabled={item.disabled}>{item.label}</option>)}
          </select>
        </div>
      </div>;
    }

    return (
      <div
        className={c('dropdown', className, {
          'dropdown--opened': this.state.isOpen,
          'dropdown--reversed': this.props.reversed,
        })}
      >
        <div className="dropdown__current-item" onClick={this.toggle}>
          <div className="dropdown__current-item__text">
            {currentLabel}
          </div>
        </div>
        <div className="dropdown__options">
          {items.map(({ label, disabled, value }, i) => (
            <div
              key={i}
              className={c('dropdown__option', {
                'dropdown__option--disabled': disabled,
              })}
              onClick={() => !disabled && this.select(value || i)}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    );
  }
}
