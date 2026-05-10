import React from 'react';
import PropTypes from 'prop-types';
import {shell} from 'electron';
import './docs-help.scss';

export default function DocsHelp({title, children, href}) {
  return (
    <div className="docs-help">
      <div>
        <div className="docs-help__title">{title}</div>
        <div className="docs-help__body">{children}</div>
      </div>
      {href && (
        <button
          className="docs-help__button"
          onClick={() => shell.openExternal(href)}
        >
          Learn More
        </button>
      )}
    </div>
  );
}

DocsHelp.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  href: PropTypes.string,
};
