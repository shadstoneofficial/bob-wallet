import React, { Component } from 'react';
import PropTypes from 'prop-types';
import c from 'classnames';
import WizardHeader from '../../../components/WizardHeader';
import './select-rescan-strategy.scss';

const YEAR = 'year';
const FULL = 'full';
const HEIGHT = 'height';
const GENESIS_DATE = Date.UTC(2020, 1, 3);
const BLOCKS_PER_DAY = 144;
const SAFETY_BUFFER_DAYS = 45;
const FIRST_YEAR = 2020;

function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];

  for (let year = currentYear; year >= FIRST_YEAR; year--) {
    years.push(year);
  }

  return years;
}

function heightFromYear(year) {
  const selected = Date.UTC(year, 0, 1);
  const buffered = selected - SAFETY_BUFFER_DAYS * 24 * 60 * 60 * 1000;
  const days = Math.floor((buffered - GENESIS_DATE) / (24 * 60 * 60 * 1000));
  return Math.max(0, days * BLOCKS_PER_DAY);
}

export default class SelectRescanStrategy extends Component {
  static propTypes = {
    currentStep: PropTypes.number.isRequired,
    totalSteps: PropTypes.number.isRequired,
    onBack: PropTypes.func.isRequired,
    onNext: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired,
    isLoading: PropTypes.bool,
  };

  static defaultProps = {
    isLoading: false,
  };

  state = {
    mode: YEAR,
    year: getYearOptions()[0],
    height: '',
  };

  getRescanHeight() {
    if (this.state.mode === FULL) {
      return 0;
    }

    if (this.state.mode === HEIGHT) {
      return Math.max(0, parseInt(this.state.height, 10));
    }

    return heightFromYear(this.state.year);
  }

  isValid() {
    if (this.state.mode !== HEIGHT) {
      return true;
    }

    const height = parseInt(this.state.height, 10);
    return Number.isInteger(height) && height >= 0;
  }

  onSubmit = () => {
    if (!this.isValid()) {
      return;
    }

    this.props.onNext(this.getRescanHeight());
  };

  renderOption(mode, title, body, children) {
    const selected = this.state.mode === mode;

    return (
      <div
        role="button"
        tabIndex={0}
        className={c('select-rescan-strategy__option', {
          'select-rescan-strategy__option--selected': selected,
        })}
        onClick={() => this.setState({mode})}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            this.setState({mode});
          }
        }}
      >
        <span className="select-rescan-strategy__option-check" />
        <span className="select-rescan-strategy__option-copy">
          <span className="select-rescan-strategy__option-title">{title}</span>
          <span className="select-rescan-strategy__option-body">{body}</span>
          {children}
        </span>
      </div>
    );
  }

  renderYearSelect() {
    return (
      <label className="select-rescan-strategy__field">
        <span>I first used this wallet around</span>
        <select
          value={this.state.year}
          onClick={e => e.stopPropagation()}
          onChange={e => this.setState({year: parseInt(e.target.value, 10)})}
        >
          {getYearOptions().map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </label>
    );
  }

  renderHeightInput() {
    return (
      <label className="select-rescan-strategy__field">
        <span>Start from block height</span>
        <input
          type="number"
          min="0"
          value={this.state.height}
          onClick={e => e.stopPropagation()}
          onChange={e => this.setState({height: e.target.value})}
          placeholder="0"
        />
      </label>
    );
  }

  render() {
    const {currentStep, totalSteps, onBack, onCancel, isLoading} = this.props;

    return (
      <div className="select-rescan-strategy">
        <WizardHeader
          currentStep={currentStep}
          totalSteps={totalSteps}
          onBack={onBack}
          onCancel={onCancel}
        />
        <div className="select-rescan-strategy__content">
          <div className="select-rescan-strategy__header-text">
            Recover wallet history
          </div>
          <div className="select-rescan-strategy__body-text">
            Bob can restore faster if you remember roughly when you first used this wallet. Recovery runs in the background, so older HNS, names, and bids may appear as scanning continues.
          </div>
          <div className="select-rescan-strategy__options">
            {this.renderOption(
              YEAR,
              'Estimate from wallet age',
              'Recommended. Choose a year and Bob will scan from safely before then.',
              this.renderYearSelect()
            )}
            {this.renderOption(
              FULL,
              'Scan everything',
              'Slowest but safest if you are not sure when this wallet was first used.'
            )}
            {this.renderOption(
              HEIGHT,
              'Advanced block height',
              'Use this if you know the exact block height to start from.',
              this.renderHeightInput()
            )}
          </div>
        </div>
        <div className="select-rescan-strategy__footer">
          <button
            className="extension_cta_button create_cta"
            onClick={this.onSubmit}
            disabled={isLoading || !this.isValid()}
          >
            {isLoading ? 'Restoring...' : 'Restore Wallet'}
          </button>
        </div>
      </div>
    );
  }
}
