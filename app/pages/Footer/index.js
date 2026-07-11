import React, { Component } from 'react';
import { connect } from 'react-redux';
import Hash from '../../components/Hash';
import './index.scss';
import Anchor from '../../components/Anchor';

// @connect(
//   state => ({
//     height: state.chain.height
//     currentHash: state.chain.currentHash
//   }),
//   null
// )
export default class Footer extends Component {
  render() {
    return (
      <div className="window-footer">
        <div className="window-footer__centerer">
          <div className="window-footer__40">
            <div className="window-footer__hashinfo">
              <p className="window-footer__explainer">
                {/* // Temp Fix until we have the blockchain connected */}
                {/* <strong>Current height:</strong> {this.props.height} */}
                <strong>Current height:</strong> 0
              </p>
              <p className="window-footer__explainer">
                <strong>Current hash:</strong>{' '}
                {/* // Temp Fix until we have the blockchain connected */}
                {/* <Hash value={this.props.currentHash} /> */}0
              </p>
            </div>

            <p className="window-footer__explainer">
              Allison Animates the Web is a free and open source client-side
              tool to manage HNS coins, auction names, and resolve Handshake
              domains. This was built for those who want full control of their
              funds and domains without any custodian.
            </p>
          </div>
          <div className="window-footer__20">
            <div className="window-footer__nav-header">AAW</div>
            <ul className="window-footer__nav-links">
              <li>
                <Anchor href="https://handshake.org/faq">
                  FAQ
                </Anchor>
              </li>
              <li>
                <a>Terms of Use</a>
              </li>
            </ul>
          </div>
          <div className="window-footer__20">
            <div className="window-footer__nav-header">Handshake</div>
            <ul className="window-footer__nav-links">
              <li>
                <a>Redeem coins</a>
              </li>
              <li>
                <Anchor href="https://handshake.org/">
                  handshake.org
                </Anchor>
              </li>
            </ul>
          </div>
          <div className="window-footer__20">
            <div className="window-footer__nav-header">Community</div>
            <ul className="window-footer__nav-links">
              <li>
                <Anchor href="https://github.com/handshake-org/">
                  GitHub
                </Anchor>
              </li>
              <li>
                <Anchor href="https://twitter.com/hns">
                  Twitter
                </Anchor>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }
}
